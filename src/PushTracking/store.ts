export type Commit = { sha: string; subject: string; author: string };
export type StageKind = "workflow" | "artifact" | "container";
export type StageStatus = "queued" | "running" | "success" | "failure" | "skipped" | "cancelled";
export type Stage = { kind: StageKind; key: string; status: StageStatus; detail: Record<string, unknown> };

/** Details known once GitHub's `push` event arrived. Pushes created by other events have none yet. */
export type PushDetails = {
	before: string | null;
	pusher: string | null;
	commits: Commit[] | null;
	compareUrl: string | null;
	forced: boolean;
};

export type Push = PushDetails & {
	id: number;
	repo: string;
	sha: string;
	superseded: boolean;
	deployedVia: number | null;
	messageId: string | null;
	/** Incremented by every change that affects the rendered message. */
	version: number;
	renderedVersion: number;
};

export interface PushStore {
	/** Records a webhook delivery ID. Returns false if it was seen before. */
	claimDelivery(id: string, source: string): Promise<boolean>;
	releaseDelivery(id: string): Promise<void>;
	/** Finds or creates the push for `repo` + full `sha`. Supplied details overwrite stored ones. */
	upsertPush(repo: string, sha: string, details?: PushDetails): Promise<Push>;
	get(id: number): Promise<Push | undefined>;
	/** Newest push in `repo` whose SHA starts with `prefix` (release versions often carry 7 characters). */
	findByCommit(repo: string, prefix: string): Promise<Push | undefined>;
	/** Newest pushes in `repo`, most recent first. */
	recent(repo: string, limit: number): Promise<Push[]>;
	setStage(pushId: number, stage: Stage): Promise<void>;
	stages(pushId: number): Promise<Stage[]>;
	mark(id: number, patch: { superseded?: boolean; deployedVia?: number }): Promise<void>;
	/** Stores the Discord message without requesting another render. */
	setMessage(id: number, messageId: string): Promise<void>;
	rendered(id: number, version: number): Promise<void>;
	/** Pushes whose message is out of date, oldest first. */
	pendingRenders(limit: number): Promise<Push[]>;
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class MemoryPushStore implements PushStore {
	private deliveries = new Set<string>();
	private pushes: Push[] = [];
	private stageMap = new Map<number, Stage[]>();

	async claimDelivery(id: string): Promise<boolean> {
		if (this.deliveries.has(id)) return false;
		this.deliveries.add(id);
		return true;
	}
	async releaseDelivery(id: string): Promise<void> {
		this.deliveries.delete(id);
	}
	async upsertPush(repo: string, sha: string, details?: PushDetails): Promise<Push> {
		let push = this.pushes.find((item) => sameRepo(item.repo, repo) && item.sha === sha);
		if (!push) {
			push = {
				id: this.pushes.length + 1,
				repo,
				sha,
				before: null,
				pusher: null,
				commits: null,
				compareUrl: null,
				forced: false,
				superseded: false,
				deployedVia: null,
				messageId: null,
				version: 1,
				renderedVersion: 0,
			};
			this.pushes.push(push);
		}
		if (details) {
			Object.assign(push, structuredClone(details), { repo });
			push.version++;
		}
		return structuredClone(push);
	}
	async get(id: number): Promise<Push | undefined> {
		const push = this.pushes.find((item) => item.id === id);
		return push && structuredClone(push);
	}
	async findByCommit(repo: string, prefix: string): Promise<Push | undefined> {
		const push = this.pushes.findLast((item) => sameRepo(item.repo, repo) && item.sha.startsWith(prefix.toLowerCase()));
		return push && structuredClone(push);
	}
	async recent(repo: string, limit: number): Promise<Push[]> {
		return structuredClone(
			this.pushes
				.filter((item) => sameRepo(item.repo, repo))
				.reverse()
				.slice(0, limit),
		);
	}
	async setStage(pushId: number, stage: Stage): Promise<void> {
		const stages = this.stageMap.get(pushId) ?? [];
		const index = stages.findIndex((item) => item.kind === stage.kind && item.key === stage.key);
		if (index >= 0) stages[index] = structuredClone(stage);
		else stages.push(structuredClone(stage));
		this.stageMap.set(pushId, stages);
		this.bump(pushId);
	}
	async stages(pushId: number): Promise<Stage[]> {
		// Stable display order: CI, then deployments, then containers, each in creation order.
		const order: Record<string, number> = { workflow: 0, artifact: 1, container: 2 };
		return structuredClone(this.stageMap.get(pushId) ?? []).sort((a, b) => order[a.kind] - order[b.kind]);
	}
	async mark(id: number, patch: { superseded?: boolean; deployedVia?: number }): Promise<void> {
		const push = this.pushes.find((item) => item.id === id)!;
		Object.assign(push, patch);
		this.bump(id);
	}
	async setMessage(id: number, messageId: string): Promise<void> {
		this.pushes.find((item) => item.id === id)!.messageId = messageId;
	}
	async rendered(id: number, version: number): Promise<void> {
		const push = this.pushes.find((item) => item.id === id)!;
		push.renderedVersion = Math.max(push.renderedVersion, version);
	}
	async pendingRenders(limit: number): Promise<Push[]> {
		return structuredClone(this.pushes.filter((item) => item.version > item.renderedVersion).slice(0, limit));
	}
	private bump(id: number) {
		const push = this.pushes.find((item) => item.id === id);
		if (push) push.version++;
	}
}
