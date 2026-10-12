import { timingSafeEqual } from "node:crypto";
import type { Client } from "discord.js";
import express, { type Express } from "express";
import { z } from "zod";
import { acquireDeploymentLock } from "./utils/DeploymentLock.js";
import { PluginDeployment, type Server } from "./utils/PluginDeployment.js";

const CHANNEL = "808030927937994772";
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
};
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
		private notify: (content: string) => Promise<void>,
		private now: () => number = Date.now,
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
				await this.store.update(job.id, {
					attempts,
					status: terminal ? "failed" : "pending",
					last_error: error instanceof Error ? error.message : "Unexpected deployment error",
					next_attempt: new Date(this.now() + Math.min(300_000, 5000 * 2 ** (attempts - 1))).toISOString(),
				});
				if (terminal) {
					console.error(`Reposilite: deployment failed for ${job.payload.path}: ${job.last_error}`);
					await this.safeNotify(
						`Automatic deployment failed for ${job.payload.path} after ${attempts} attempts. ${job.completed.length} server(s) completed. Check the bot logs before retrying.`,
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
		if (!artifact) {
			await this.store.update(job.id, { status: "ignored" });
			return;
		}
		if (job.targets === null) {
			job.targets = (await service.servers(DEV_SCOPE)).map(({ identifier, name }) => ({ identifier, name }));
			await this.store.update(job.id, { targets: job.targets });
		}
		if (!job.notified) {
			job.notified = true;
			await this.store.update(job.id, { notified: true });
			await this.safeNotify(
				`Deploying ${uploaded.id} ${uploaded.version} (${artifact.type}) to ${job.targets.length} Lords of Minecraft Dev Server(s). Uploaded by ${job.payload.uploadedBy}. No restart will be performed.`,
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
				try {
					await service.deploy(server.identifier, uploaded.id, { version: uploaded.version, scope: DEV_SCOPE });
				} catch (error) {
					failures.push(`${server.name}: ${error instanceof Error ? error.message : "Unexpected error"}`);
					continue;
				}
				job.completed.push(server.identifier);
				await this.store.update(job.id, { completed: job.completed });
			} finally {
				release();
			}
		}
		if (failures.length) throw new Error(failures.join("; "));
		await this.store.update(job.id, { status: "completed", last_error: "" });
		await this.safeNotify(
			`Uploaded ${uploaded.id} ${uploaded.version} to ${job.targets.map((server) => server.name).join(", ") || "no matching dev servers"}. Restart servers manually to apply the release.`,
		);
	}
	private async safeNotify(content: string): Promise<void> {
		try {
			await this.notify(content);
		} catch {
			console.error("Reposilite: Discord notification failed; deployment processing continues");
		}
	}
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

export default function ReposiliteWebhook(client: Client, server: Express): void {
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
		async (content) => {
			const channel = await client.channels.fetch(CHANNEL);
			if (channel?.isSendable()) await channel.send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
		},
	);
	const tick = () => {
		void worker.tick().catch(() => console.error("Reposilite: queue processing failed; will retry"));
	};
	setInterval(tick, 5000).unref();
	tick();
}
