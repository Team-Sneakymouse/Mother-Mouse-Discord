import { timingSafeEqual } from "node:crypto";
import { type Client, MessageFlags } from "discord.js";
import express, { type Express } from "express";
import { z } from "zod";
import { acquireDeploymentLock } from "./utils/DeploymentLock.js";
import { type Artifact, type ArtifactSource, isProxy, PluginDeployment, type Server } from "./utils/PluginDeployment.js";

export const DEV_UPDATE_THREAD = "1561330944395313255";
export const DEV_SCOPE = ["Lords of Minecraft", "Dev Server"];
const eventSchema = z.object({
	event: z.literal("artifact.uploaded"),
	schemaVersion: z.literal(1),
	id: z.uuid(),
	timestamp: z.iso.datetime(),
	repository: z.string().max(100),
	path: z.string().max(2048),
	uploadedBy: z.string().max(500),
});
export type UploadEvent = z.infer<typeof eventSchema>;
export type WebhookJob = {
	id: string;
	payload: UploadEvent;
	status: string;
	attempts: number;
	next_attempt: string;
	targets: Pick<Server, "identifier" | "name">[] | null;
	completed: string[];
	notified: boolean;
	last_error: string;
	message_id?: string;
	/** GitHub origin of the uploaded artifact; null when its POM has none. Undefined until resolved. */
	source?: ArtifactSource | null;
};
export type DeploymentStatus = "running" | "success" | "failure" | "skipped";
/** Shows deployment progress on the message of the push that produced the artifact. */
export interface DeploymentTracker {
	/** Returns false when no tracked push matches; the worker then posts its own message. */
	artifact(source: ArtifactSource, update: { id: string; status: DeploymentStatus; text: string }): Promise<boolean>;
}
export interface EventStore {
	accept(event: UploadEvent): Promise<boolean>;
	next(): Promise<WebhookJob | undefined>;
	update(id: string, patch: Partial<WebhookJob>): Promise<void>;
}

export function uploadedArtifact(event: UploadEvent): { id: string; version: string } | undefined {
	if (event.repository !== "releases") return;
	const parts = event.path.split("/");
	if (parts.length !== 6 || parts.slice(0, 3).join("/") !== "io/github/team-sneakymouse") return;
	const [, , , id, version, filename] = parts;
	const segment = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
	if (!segment.test(id) || !segment.test(version) || version.endsWith("-SNAPSHOT") || filename !== `${id}-${version}.jar`) return;
	return { id, version };
}

export class MemoryEventStore implements EventStore {
	private records = new Map<string, WebhookJob>();
	get jobs(): WebhookJob[] {
		return [...this.records.values()];
	}
	async accept(event: UploadEvent): Promise<boolean> {
		const existing = this.records.get(event.id);
		if (existing) {
			if (Object.keys(event).some((key) => existing.payload[key as keyof UploadEvent] !== event[key as keyof UploadEvent]))
				throw new Error("Event ID was reused with a different payload");
			return false;
		}
		if (this.records.size >= 10_000) {
			const finished = this.jobs.find((job) => job.status !== "pending");
			if (!finished) throw new Error("Webhook queue is full");
			this.records.delete(finished.id);
		}
		this.records.set(event.id, {
			id: event.id,
			payload: structuredClone(event),
			status: "pending",
			attempts: 0,
			next_attempt: new Date().toISOString(),
			targets: null,
			completed: [],
			notified: false,
			last_error: "",
		});
		return true;
	}
	async next(): Promise<WebhookJob | undefined> {
		return this.jobs.find((job) => job.status === "pending");
	}
	async update(id: string, patch: Partial<WebhookJob>): Promise<void> {
		Object.assign(this.records.get(id)!, patch);
	}
}

export class ReposiliteWorker {
	private running = false;
	constructor(
		private store: EventStore,
		private service: () => PluginDeployment,
		private notify: (content: string, job: WebhookJob) => Promise<void>,
		private now: () => number = Date.now,
		private tracker?: DeploymentTracker,
	) {}
	async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			// Keep acceptance order, including delayed retries, so an older release cannot overtake a newer event.
			const job = await this.store.next();
			if (!job || new Date(job.next_attempt).getTime() > this.now()) return;
			try {
				await this.process(job);
			} catch (error) {
				const attempts = job.attempts + 1;
				const terminal = attempts >= 12;
				const lastError = error instanceof Error ? error.message : "Unexpected deployment error";
				await this.store.update(job.id, {
					attempts,
					status: terminal ? "failed" : "pending",
					last_error: lastError,
					next_attempt: new Date(this.now() + Math.min(300_000, 5000 * 2 ** (attempts - 1))).toISOString(),
				});
				if (terminal) {
					console.error(`Reposilite: deployment failed for ${job.payload.path}: ${lastError}`);
					if (job.notified) {
						await this.report(
							job,
							"failure",
							`Automatic deployment failed for \`${job.payload.path}\` after ${attempts} attempts. ${job.completed.length} server(s) completed. Check the bot logs before retrying.`,
						);
					}
				} else if (job.notified) {
					// Eligibility checks also retry; only update Discord after deployment preparation succeeded.
					await this.report(
						job,
						"running",
						`Automatic deployment of \`${job.payload.path}\` is waiting to retry (attempt ${attempts}/12). ${job.completed.length}/${job.targets?.length ?? "?"} dev server(s) completed.`,
					);
				}
			}
		} finally {
			this.running = false;
		}
	}
	private async process(job: WebhookJob): Promise<void> {
		const uploaded = uploadedArtifact(job.payload);
		if (!uploaded) {
			await this.store.update(job.id, { status: "ignored" });
			return;
		}
		const service = this.service();
		// A missing POM or metadata throws and gets retried; an explicit unsupported/missing property is ignored.
		const artifact = await service.artifact(uploaded.id, uploaded.version);
		// Velocity plugins are deployed manually until there is a dev proxy; dual-platform JARs still reach Paper dev servers.
		if (!artifact || artifact.types.every((type) => type === "velocity-plugin")) {
			await this.store.update(job.id, { status: "ignored" });
			return;
		}
		if (job.targets === null) {
			job.targets = (await service.servers(DEV_SCOPE)).filter((server) => !isProxy(server)).map(({ identifier, name }) => ({ identifier, name }));
			await this.store.update(job.id, { targets: job.targets });
		}
		if (job.source === undefined) {
			job.source = artifact.source ?? null;
			await this.store.update(job.id, { source: job.source });
		}
		if (!job.notified) {
			job.notified = true;
			await this.store.update(job.id, { notified: true });
			await this.report(
				job,
				"running",
				`Deploying **${uploaded.id}** \`${uploaded.version}\` (${artifact.types.join(", ")}) to ${job.targets.length} dev server(s).`,
			);
		}
		const failures: string[] = [];
		for (const server of job.targets) {
			if (job.completed.includes(server.identifier)) continue;
			const release = acquireDeploymentLock(server.identifier);
			if (!release) {
				failures.push(`${server.name}: another deployment is running`);
				continue;
			}
			try {
				let deployed: Artifact;
				try {
					deployed = await service.deploy(server.identifier, uploaded.id, { version: uploaded.version, scope: DEV_SCOPE });
				} catch (error) {
					failures.push(`${server.name}: ${error instanceof Error ? error.message : "Unexpected error"}`);
					continue;
				}
				try {
					await service.announceUpdate(server.identifier, deployed);
				} catch {
					console.error(`Reposilite: update announcement failed for ${server.name}; deployment processing continues`);
				}
				job.completed.push(server.identifier);
				await this.store.update(job.id, { completed: job.completed });
			} finally {
				release();
			}
		}
		if (failures.length) throw new Error(failures.join("; "));
		await this.store.update(job.id, { status: "completed", last_error: "" });
		await this.report(
			job,
			job.targets.length ? "success" : "skipped",
			job.targets.length
				? `Uploaded **${uploaded.id}** \`${uploaded.version}\` to ${job.targets.map((server) => server.name).join(", ")}.`
				: `Skipped **${uploaded.id}** \`${uploaded.version}\`: no matching dev servers.`,
		);
	}
	/** Updates the tracked push's message, or this upload's own message when no push matches. */
	private async report(job: WebhookJob, status: DeploymentStatus, content: string): Promise<void> {
		const uploaded = uploadedArtifact(job.payload);
		if (this.tracker && job.source && uploaded) {
			try {
				if (await this.tracker.artifact(job.source, { id: uploaded.id, status, text: content.slice(0, 600) })) return;
			} catch {
				console.error("Reposilite: push tracking update failed; posting a separate message instead");
			}
		}
		try {
			await this.notify(content.slice(0, 2000), job);
		} catch {
			console.error("Reposilite: Discord notification failed; deployment processing continues");
		}
	}
}

export function createDevUpdateNotifier(client: Client, store: EventStore) {
	return async (content: string, job: WebhookJob): Promise<void> => {
		const thread = await client.channels.fetch(DEV_UPDATE_THREAD);
		if (!thread?.isThread() || !thread.isSendable()) throw new Error("Dev update thread is unavailable");
		if (thread.archived) await thread.setArchived(false);
		const payload = { content, allowedMentions: { parse: [] as const }, flags: MessageFlags.SuppressEmbeds as const };
		if (job.message_id) {
			try {
				await thread.messages.edit(job.message_id, payload);
				return;
			} catch (error) {
				// Recreate a deleted message, but do not duplicate posts after transient errors.
				if ((error as { code?: number }).code !== 10008) throw error;
			}
		}
		const message = await thread.send(payload);
		job.message_id = message.id;
		await store.update(job.id, { message_id: message.id });
	};
}

export function registerReposiliteRoute(
	server: Express,
	store: EventStore,
	token: () => string | undefined = () => process.env.REPOSILITE_WEBHOOK_TOKEN,
): void {
	server.post("/reposilite", express.json({ limit: "16kb" }), async (req, res) => {
		const expected = token();
		if (!expected) {
			res.sendStatus(503);
			return;
		}
		const supplied = req.get("Authorization") ?? "";
		const wanted = `Bearer ${expected}`;
		if (Buffer.byteLength(supplied) !== Buffer.byteLength(wanted) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(wanted))) {
			res.sendStatus(401);
			return;
		}
		const result = eventSchema.safeParse(req.body);
		if (!result.success || req.get("X-Reposilite-Event-Id") !== result.data.id) {
			res.sendStatus(400);
			return;
		}
		if (!uploadedArtifact(result.data)) {
			res.sendStatus(204);
			return;
		}
		try {
			res.sendStatus((await store.accept(result.data)) ? 202 : 200);
		} catch (error) {
			console.error("Reposilite: could not queue webhook event");
			res.sendStatus(error instanceof Error && error.message.startsWith("Event ID") ? 409 : 503);
		}
	});
}

export default function ReposiliteWebhook(client: Client, server: Express, tracker?: DeploymentTracker): void {
	const store = new MemoryEventStore();
	registerReposiliteRoute(server, store);
	if (!process.env.REPOSILITE_WEBHOOK_TOKEN) {
		console.log("Reposilite: webhook disabled until REPOSILITE_WEBHOOK_TOKEN is configured");
		return;
	}
	const worker = new ReposiliteWorker(
		store,
		() => {
			const host = process.env.PELICAN_API_HOST,
				app = process.env.PELICAN_APPLICATION_KEY,
				key = process.env.PELICAN_CLIENT_KEY;
			if (!host || !app || !key) throw new Error("Pelican API credentials are missing");
			return new PluginDeployment(host, app, key);
		},
		createDevUpdateNotifier(client, store),
		Date.now,
		tracker,
	);
	const tick = () => {
		void worker.tick().catch(() => console.error("Reposilite: queue processing failed; will retry"));
	};
	setInterval(tick, 5000).unref();
	tick();
}
