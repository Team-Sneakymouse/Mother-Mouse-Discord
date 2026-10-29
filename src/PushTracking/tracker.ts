import { z } from "zod";
import type { ArtifactSource } from "../utils/PluginDeployment.js";
import { COLOR, plain, type PushMessage, renderPush } from "./render.js";
import type { Commit, Push, PushStore, Stage, StageStatus } from "./store.js";

export const ORG = "Team-Sneakymouse";
const ZERO = /^0+$/;
const sha = z.string().regex(/^[a-f0-9]{40}$/i);
const repoName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

const pushSchema = z.object({
	ref: z.string(),
	before: z.string(),
	after: z.string(),
	deleted: z.boolean().optional(),
	forced: z.boolean().optional(),
	compare: z.string().url().optional(),
	pusher: z.object({ name: z.string() }).partial().optional(),
	sender: z.object({ login: z.string() }).partial().optional(),
	commits: z
		.array(
			z.object({
				id: sha,
				message: z.string(),
				author: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
			}),
		)
		.default([]),
	repository: z.object({ full_name: repoName, default_branch: z.string() }),
});

const workflowSchema = z.object({
	action: z.string(),
	workflow_run: z.object({
		id: z.number(),
		workflow_id: z.number(),
		name: z.string().nullish(),
		head_sha: sha,
		head_branch: z.string().nullish(),
		event: z.string(),
		status: z.string().nullish(),
		conclusion: z.string().nullish(),
		html_url: z.string().url().optional(),
		run_attempt: z.number().optional(),
	}),
	repository: z.object({ full_name: repoName, default_branch: z.string() }),
});

const containerSchema = z.object({
	name: z.string(),
	imageName: z.string().optional(),
	state: z.string().optional(),
	error: z.string().optional(),
	latestImageRevision: z.string().optional(),
	ociSource: z.string().optional(),
});
export const watchtowerSchema = z.object({
	report: z
		.object({
			updated: z.array(containerSchema).nullish(),
			failed: z.array(containerSchema).nullish(),
		})
		.nullish(),
});

export type ArtifactUpdate = { id: string; status: StageStatus; text: string };

export interface MessageSink {
	send(message: PushMessage): Promise<string>;
	/** Rejects with `{ code: 10008 }` when the message was deleted. */
	edit(id: string, message: PushMessage): Promise<void>;
	link(id: string): string;
}

function workflowStatus(run: z.infer<typeof workflowSchema>["workflow_run"]): StageStatus {
	if (run.status !== "completed") return run.status === "in_progress" ? "running" : "queued";
	if (run.conclusion === "success") return "success";
	if (run.conclusion === "skipped" || run.conclusion === "neutral") return "skipped";
	if (run.conclusion === "cancelled") return "cancelled";
	return "failure";
}

/** `https://github.com/Team-Sneakymouse/Repo(.git)` → `Team-Sneakymouse/Repo` */
export function githubRepo(url: string | undefined): string | undefined {
	const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url ?? "");
	return match?.[1];
}

// Workflow events are ordered by run ID, then attempt, then phase within an attempt.
const PHASE: Record<StageStatus, number> = { queued: 0, running: 1, success: 2, failure: 2, skipped: 2, cancelled: 2 };
type Progress = [run: number, attempt: number, phase: number];
const progressOf = (stage: Stage): Progress => [Number(stage.detail.run) || 0, Number(stage.detail.attempt) || 1, PHASE[stage.status] ?? 0];
function compareProgress(a: Progress, b: Progress): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

const deployed = (stages: Stage[]) => stages.some((stage) => stage.kind !== "workflow" && (stage.status === "success" || stage.status === "running"));

export class PushTracker {
	private flushing = false;
	private retryAt = new Map<number, { at: number; failures: number }>();

	constructor(
		private store: PushStore,
		private sink: MessageSink,
		private now: () => number = Date.now,
	) {}

	/** GitHub `push` event. */
	async push(payload: unknown): Promise<void> {
		const event = pushSchema.parse(payload);
		if (event.ref !== `refs/heads/${event.repository.default_branch}` || event.deleted || ZERO.test(event.after)) return;
		const repo = event.repository.full_name;
		const commits: Commit[] = event.commits.slice(-100).map((commit) => ({
			sha: commit.id.toLowerCase(),
			subject: commit.message.split(/\r?\n/)[0].slice(0, 200),
			author: commit.author?.username ?? commit.author?.name ?? "",
		}));
		const push = await this.store.upsertPush(repo, event.after.toLowerCase(), {
			before: ZERO.test(event.before) ? null : event.before.toLowerCase(),
			pusher: event.pusher?.name ?? event.sender?.login ?? null,
			commits,
			compareUrl: event.compare ?? null,
			forced: event.forced ?? false,
		});
		if (event.forced) {
			// Earlier, undeployed pushes may reference commits the force push removed.
			for (const older of await this.store.recent(repo, 20)) {
				if (older.id >= push.id || older.superseded || older.deployedVia) continue;
				if (deployed(await this.store.stages(older.id))) continue;
				await this.store.mark(older.id, { superseded: true });
			}
		}
		// This push's `before` may complete a chain for a deployment that was reported first.
		await this.reconcile(repo);
	}

	/** GitHub `workflow_run` event. Only runs triggered by pushes to the default branch are tracked. */
	async workflowRun(payload: unknown): Promise<void> {
		const event = workflowSchema.parse(payload);
		const run = event.workflow_run;
		if (run.event !== "push" || run.head_branch !== event.repository.default_branch) return;
		const push = await this.store.upsertPush(event.repository.full_name, run.head_sha.toLowerCase());
		const key = String(run.workflow_id);
		const status = workflowStatus(run);
		const attempt = run.run_attempt ?? 1;
		// GitHub may deliver a run's events late; never let an older run, attempt or phase replace a newer one.
		const current = (await this.store.stages(push.id)).find((stage) => stage.kind === "workflow" && stage.key === key);
		if (current && compareProgress([run.id, attempt, PHASE[status]], progressOf(current)) < 0) return;
		await this.store.setStage(push.id, {
			kind: "workflow",
			key,
			status,
			detail: { name: run.name ?? "Workflow", url: run.html_url, attempt, run: run.id },
		});
	}

	/** Progress of an automatic dev-server deployment. Returns false when no tracked push matches. */
	async artifact(source: ArtifactSource, update: ArtifactUpdate): Promise<boolean> {
		const push = await this.store.findByCommit(source.repository, source.commit);
		if (!push) return false;
		await this.store.setStage(push.id, { kind: "artifact", key: update.id, status: update.status, detail: { text: update.text } });
		if (update.status === "success") await this.includeEarlier(push);
		return true;
	}

	/** A container was updated to an image built from `repo`@`sha`. Returns false when no tracked push matches. */
	async container(repo: string, sha: string, name: string, status: StageStatus, error?: string): Promise<boolean> {
		if (!/^[a-f0-9]{7,40}$/i.test(sha)) return false;
		const push = await this.store.findByCommit(repo, sha);
		if (!push) return false;
		await this.store.setStage(push.id, { kind: "container", key: name.replace(/^\//, ""), status, detail: error ? { error } : {} });
		if (status === "success") await this.includeEarlier(push);
		return true;
	}

	/** Watchtower `json.v1` notification. Updates of untracked images get their own message. */
	async watchtower(payload: unknown): Promise<void> {
		const report = watchtowerSchema.parse(payload).report;
		if (!report) return; // Startup and log-only notifications carry no report.
		const entries = [
			...(report.updated ?? []).map((entry) => ({ entry, status: "success" as const })),
			...(report.failed ?? []).map((entry) => ({ entry, status: "failure" as const })),
		];
		for (const { entry, status } of entries) {
			const repo = githubRepo(entry.ociSource);
			const tracked = repo && entry.latestImageRevision ? await this.container(repo, entry.latestImageRevision, entry.name, status, entry.error) : false;
			if (tracked) continue;
			const name = plain(entry.name.replace(/^\//, ""), 100);
			const image = entry.imageName ? ` (\`${plain(entry.imageName, 200)}\`)` : "";
			await this.sink.send({
				color: COLOR[status],
				sections: [
					status === "success"
						? `🐳 Updated container \`${name}\`${image}.`
						: `❌ 🐳 Updating container \`${name}\`${image} failed${entry.error ? `: ${plain(entry.error)}` : "."}`,
				],
			});
		}
	}

	/** Re-applies `includeEarlier` for recent deployed pushes, for chains whose links arrived late. */
	private async reconcile(repo: string): Promise<void> {
		for (const push of await this.store.recent(repo, 20)) {
			const stages = await this.store.stages(push.id);
			if (stages.some((stage) => stage.kind !== "workflow" && stage.status === "success")) await this.includeEarlier(push);
		}
	}

	/**
	 * A deployment of `push` also ships earlier pushes whose own builds failed or were skipped.
	 * Non-forced pushes form a chain through `before`.
	 */
	private async includeEarlier(push: Push): Promise<void> {
		let before = push.before;
		for (let depth = 0; before && depth < 50; depth++) {
			const earlier = await this.store.findByCommit(push.repo, before);
			if (!earlier || earlier.sha !== before || earlier.deployedVia || earlier.superseded) return;
			if (deployed(await this.store.stages(earlier.id))) return;
			await this.store.mark(earlier.id, { deployedVia: push.id });
			before = earlier.before;
		}
	}

	/** Sends or edits messages for pushes that changed since they were last rendered. */
	async flush(): Promise<void> {
		if (this.flushing) return;
		this.flushing = true;
		try {
			for (const push of await this.store.pendingRenders(25)) {
				const retry = this.retryAt.get(push.id);
				if (retry && retry.at > this.now()) continue;
				try {
					await this.render(push);
					this.retryAt.delete(push.id);
				} catch (error) {
					const failures = (retry?.failures ?? 0) + 1;
					this.retryAt.set(push.id, { at: this.now() + Math.min(300_000, 2000 * 2 ** failures), failures });
					if (failures === 1 || failures % 10 === 0)
						console.error(`PushTracking: message for ${push.repo}@${push.sha.slice(0, 7)} failed (${failures}x): ${(error as Error)?.message ?? error}`);
				}
			}
		} finally {
			this.flushing = false;
		}
	}

	private async render(push: Push): Promise<void> {
		const stages = await this.store.stages(push.id);
		let via: { link: string | null } | undefined;
		if (push.deployedVia) {
			const later = await this.store.get(push.deployedVia);
			via = { link: later?.messageId ? this.sink.link(later.messageId) : null };
		}
		const message = renderPush(push, stages, via);
		if (push.messageId) {
			try {
				await this.sink.edit(push.messageId, message);
				await this.store.rendered(push.id, push.version);
				return;
			} catch (error) {
				// Recreate deleted messages; other errors retry the edit rather than risk duplicates.
				if ((error as { code?: number }).code !== 10008) throw error;
			}
		}
		const id = await this.sink.send(message);
		await this.store.setMessage(push.id, id);
		await this.store.rendered(push.id, push.version);
		// Earlier pushes deployed with this one link to its message; it is new, so refresh them.
		await this.store.refreshDependents(push.id);
	}
}
