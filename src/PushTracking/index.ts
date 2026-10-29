import { SQL } from "bun";
import { type Client, MessageFlags } from "discord.js";
import type { Express } from "express";
import { DEV_UPDATE_THREAD } from "../ReposiliteWebhook.js";
import type { ArtifactSource } from "../utils/PluginDeployment.js";
import { migrate, PostgresPushStore } from "./postgres.js";
import { registerPushTrackingRoutes } from "./routes.js";
import { type ArtifactUpdate, type MessageSink, PushTracker } from "./tracker.js";

const RAWBTV = "391355330241757205";
/** Watchtower cannot report this bot's own update (it is restarting), so the bot reports it on startup. */
export const SELF = { repo: "Team-Sneakymouse/Mother-Mouse-Discord", container: "mother-mouse-discord" };

export function threadSink(client: Client, threadId = DEV_UPDATE_THREAD): MessageSink {
	const thread = async () => {
		const channel = await client.channels.fetch(threadId);
		if (!channel?.isThread() || !channel.isSendable()) throw new Error("Dev update thread is unavailable");
		if (channel.archived) await channel.setArchived(false);
		return channel;
	};
	const payload = (content: string) => ({ content, allowedMentions: { parse: [] as const }, flags: MessageFlags.SuppressEmbeds as const });
	return {
		async send(content) {
			return (await (await thread()).send(payload(content))).id;
		},
		async edit(id, content) {
			await (await thread()).messages.edit(id, payload(content));
		},
		link: (id) => `https://discord.com/channels/${RAWBTV}/${threadId}/${id}`,
	};
}

export type PushTracking = {
	/** Hook for the Reposilite worker. Resolves false when tracking is unavailable or no push matches. */
	artifact(source: ArtifactSource, update: ArtifactUpdate): Promise<boolean>;
	stop(): Promise<void>;
};

/** Must be called before the global JSON body parser is installed. */
export default function PushTracking(client: Client, server: Express): PushTracking {
	let sql: SQL | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	const feature = (async () => {
		if (!process.env.PGHOST) {
			console.log("PushTracking: disabled until PGHOST, PGUSER, PGPASSWORD and PGDATABASE are configured");
			return undefined;
		}
		try {
			sql = new SQL();
			await migrate(sql);
			const store = new PostgresPushStore(sql);
			await store.pruneDeliveries(30);
			return { store, tracker: new PushTracker(store, threadSink(client)) };
		} catch (error) {
			console.error(`PushTracking: database setup failed; tracking is disabled: ${(error as Error)?.message ?? error}`);
			return undefined;
		}
	})();
	registerPushTrackingRoutes(server, () => feature);
	if (!process.env.GITHUB_WEBHOOK_SECRET) console.log("PushTracking: GitHub webhook disabled until GITHUB_WEBHOOK_SECRET is configured");
	if (!process.env.WATCHTOWER_WEBHOOK_TOKEN) console.log("PushTracking: Watchtower webhook disabled until WATCHTOWER_WEBHOOK_TOKEN is configured");

	const start = async () => {
		const ready = await feature;
		if (!ready) return;
		const revision = process.env.GIT_SHA;
		if (revision) {
			try {
				await ready.tracker.container(SELF.repo, revision, SELF.container, "success");
			} catch {
				console.error("PushTracking: could not record this bot's own deployment");
			}
		}
		const tick = () => void ready.tracker.flush().catch(() => console.error("PushTracking: message rendering failed; will retry"));
		timer = setInterval(tick, 1000);
		timer.unref();
		tick();
	};
	if (client.isReady()) void start();
	else client.once("clientReady", () => void start());

	return {
		async artifact(source, update) {
			const ready = await feature;
			return ready ? ready.tracker.artifact(source, update) : false;
		},
		async stop() {
			if (timer) clearInterval(timer);
			await sql?.close({ timeout: 5 });
		},
	};
}
