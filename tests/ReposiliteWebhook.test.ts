import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Client } from "discord.js";
import {
	createDevUpdateNotifier,
	DEV_UPDATE_THREAD,
	DEV_SCOPE,
	type EventStore,
	MemoryEventStore,
	registerReposiliteRoute,
	ReposiliteWorker,
	type UploadEvent,
	uploadedArtifact,
	type WebhookJob,
} from "../src/ReposiliteWebhook.ts";
import { PluginDeployment } from "../src/utils/PluginDeployment.ts";
import { acquireDeploymentLock } from "../src/utils/DeploymentLock.ts";

const event: UploadEvent = {
	event: "artifact.uploaded",
	schemaVersion: 1,
	id: "d4fa61fb-1eb1-45e2-9c58-70d4af566431",
	timestamp: "2026-10-12T10:00:00Z",
	repository: "releases",
	path: "io/github/team-sneakymouse/Example/1.0/Example-1.0.jar",
	uploadedBy: "alice",
};
function memoryStore(): EventStore & { jobs: WebhookJob[] } {
	const jobs: WebhookJob[] = [];
	return {
		jobs,
		async accept(payload) {
			if (jobs.some((job) => job.payload.id === payload.id)) return false;
			jobs.push({
				id: payload.id,
				payload: structuredClone(payload),
				status: "pending",
				attempts: 0,
				next_attempt: "2026-10-12T10:00:00Z",
				targets: null,
				completed: [],
				notified: false,
				last_error: "",
			});
			return true;
		},
		async next() {
			const job = jobs.find((job) => job.status === "pending");
			return job ? structuredClone(job) : undefined;
		},
		async update(id, patch) {
			Object.assign(jobs.find((job) => job.id === id)!, structuredClone(patch));
		},
	};
}
const now = new Date("2026-10-12T11:00:00Z").getTime();
function fakeService() {
	const calls: { server: string; id: string; options: unknown }[] = [];
	const announcements: { server: string; id: string; version: string }[] = [];
	const service = {
		async artifact(id: string, version: string) {
			assert.equal(id, "Example");
			assert.equal(version, "1.0");
			return { types: ["paper-plugin"] };
		},
		async servers(scope: string[]) {
			assert.deepEqual(scope, DEV_SCOPE);
			return [
				{ identifier: "dev-one", name: "Dev one" },
				{ identifier: "dev-two", name: "Dev two" },
			];
		},
		async deploy(server: string, id: string, options: unknown) {
			calls.push({ server, id, options });
			return { id, version: "1.0" };
		},
		async announceUpdate(server: string, artifact: { id: string; version: string }) {
			assert.equal(calls.at(-1)?.server, server);
			announcements.push({ server, id: artifact.id, version: artifact.version });
		},
	};
	return { service, calls, announcements };
}

test("path filter only accepts main release JARs in the configured group", () => {
	assert.deepEqual(uploadedArtifact(event), { id: "Example", version: "1.0" });
	for (const path of [
		event.path + ".sha256",
		event.path.replace(".jar", ".pom"),
		event.path.replace(".jar", "-sources.jar"),
		event.path.replace(".jar", "-javadoc.jar"),
		event.path.replace("team-sneakymouse", "other"),
		"../Example-1.0.jar",
		event.path.replaceAll("1.0", "1.0-SNAPSHOT"),
	])
		assert.equal(uploadedArtifact({ ...event, path }), undefined);
	assert.equal(uploadedArtifact({ ...event, repository: "snapshots" }), undefined);
});

test("an unsupported JAR with unavailable Maven metadata is ignored without deployment notifications", async () => {
	const store = memoryStore();
	await store.accept({
		...event,
		path: "io/github/team-sneakymouse/magicspells-memory/2026.10.18-e26037c187c7/magicspells-memory-2026.10.18-e26037c187c7.jar",
	});
	const requests: string[] = [];
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", async (input) => {
		const url = String(input);
		requests.push(url);
		if (url.endsWith("maven-metadata.xml")) return new Response(null, { status: 404 });
		if (url.endsWith(".pom")) return new Response("<project><artifactId>magicspells-memory</artifactId></project>");
		assert.fail(`Unexpected deployment request: ${url}`);
	});
	const notifications: string[] = [];
	await new ReposiliteWorker(
		store,
		() => service,
		async (content) => {
			notifications.push(content);
		},
		() => now,
	).tick();
	assert.deepEqual(notifications, [], "Unconfirmed artifacts must not be described as deployment retries");
	assert.equal(store.jobs[0].status, "ignored");
	assert.ok(
		requests.every((url) => url.endsWith(".pom")),
		"Unsupported artifacts do not need Maven version metadata",
	);
});

test("an unreadable POM retries silently and is ignored when it becomes readable without a deployment type", async () => {
	const store = memoryStore();
	await store.accept(event);
	let available = false;
	const service = new PluginDeployment("https://panel.example/api", "application-secret", "client-secret", async (input) => {
		assert.ok(String(input).endsWith(".pom"), "Eligibility must be established before other requests");
		return available ? new Response("<project/>") : new Response(null, { status: 404 });
	});
	const notifications: string[] = [];
	const worker = new ReposiliteWorker(
		store,
		() => service,
		async (content) => {
			notifications.push(content);
		},
		() => now,
	);
	await worker.tick();
	assert.equal(store.jobs[0].status, "pending");
	assert.equal(store.jobs[0].attempts, 1);
	assert.deepEqual(notifications, []);
	available = true;
	store.jobs[0].next_attempt = new Date(now).toISOString();
	await worker.tick();
	assert.equal(store.jobs[0].status, "ignored");
	assert.deepEqual(notifications, []);
});

test("worker deploys and announces the exact event version even when Discord notification fails", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls, announcements } = fakeService();
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {
			throw new Error("Discord unavailable");
		},
		() => now,
	).tick();
	assert.equal(store.jobs[0].status, "completed");
	assert.deepEqual(
		calls,
		["dev-one", "dev-two"].map((server) => ({ server, id: "Example", options: { version: "1.0", scope: DEV_SCOPE } })),
	);
	assert.deepEqual(
		announcements,
		["dev-one", "dev-two"].map((server) => ({ server, id: "Example", version: "1.0" })),
	);
});

test("offline announcement failures complete deployments without retrying uploads", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls } = fakeService();
	const announced: string[] = [];
	service.announceUpdate = async (server) => {
		announced.push(server);
		throw new Error("Server is offline");
	};
	const worker = new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	);
	await worker.tick();
	assert.equal(store.jobs[0].status, "completed");
	assert.equal(store.jobs[0].attempts, 0);
	assert.deepEqual(store.jobs[0].completed, ["dev-one", "dev-two"]);
	assert.deepEqual(announced, ["dev-one", "dev-two"]);
	await worker.tick();
	assert.equal(calls.length, 2);
	assert.equal(announced.length, 2);
});

test("Velocity plugins are not deployed automatically and proxies are never automatic targets", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls } = fakeService();
	service.artifact = async () => ({ types: ["velocity-plugin"] });
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.equal(store.jobs[0].status, "ignored");
	assert.deepEqual(calls, []);

	// Dual-platform JARs still reach Paper dev servers, but never a proxy.
	const second = memoryStore();
	await second.accept(event);
	const backend = fakeService();
	backend.service.artifact = async () => ({ types: ["paper-plugin", "velocity-plugin"] }) as any;
	backend.service.servers = async () =>
		[
			{ identifier: "dev-one", name: "Dev one", description: "Lords of Minecraft Dev Server" },
			{ identifier: "dev-proxy", name: "Dev proxy", description: "Lords of Minecraft Dev Server Proxy" },
		] as any;
	await new ReposiliteWorker(
		second,
		() => backend.service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.equal(second.jobs[0].status, "completed");
	assert.deepEqual(
		backend.calls.map((call) => call.server),
		["dev-one"],
	);
});

test("missing POM is retried later and unsupported deployment properties are ignored", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls } = fakeService();
	let available = false;
	(service as any).artifact = async () => {
		if (!available) throw new Error("HTTP 404");
		return { types: ["ignite-mod"] };
	};
	const worker = new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	);
	await worker.tick();
	assert.equal(store.jobs[0].attempts, 1);
	assert.equal(calls.length, 0);
	available = true;
	await worker.tick();
	assert.equal(calls.length, 0);
	store.jobs[0].next_attempt = new Date(now).toISOString();
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.equal(store.jobs[0].status, "completed");
	const ignored = memoryStore();
	await ignored.accept(event);
	(service as any).artifact = async () => undefined;
	await new ReposiliteWorker(
		ignored,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.equal(ignored.jobs[0].status, "ignored");
});

test("retries skip uploads and announcements for servers already completed in memory", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls, announcements } = fakeService();
	let fail = true;
	service.deploy = async (server, id, options) => {
		calls.push({ server, id, options });
		if (server === "dev-two" && fail) throw new Error("Upload failed");
		return { id, version: "1.0" };
	};
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.deepEqual(store.jobs[0].completed, ["dev-one"]);
	assert.deepEqual(
		announcements.map((announcement) => announcement.server),
		["dev-one"],
	);
	fail = false;
	store.jobs[0].next_attempt = new Date(now).toISOString();
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.deepEqual(
		calls.map((call) => call.server),
		["dev-one", "dev-two", "dev-two"],
	);
	assert.equal(store.jobs[0].status, "completed");
	assert.deepEqual(
		announcements.map((announcement) => announcement.server),
		["dev-one", "dev-two"],
	);
});

test("an active manual server lock defers automatic upload without losing the event", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service, calls } = fakeService();
	const release = acquireDeploymentLock("dev-one")!;
	try {
		await new ReposiliteWorker(
			store,
			() => service as unknown as PluginDeployment,
			async () => {},
			() => now,
		).tick();
	} finally {
		release();
	}
	assert.deepEqual(
		calls.map((call) => call.server),
		["dev-two"],
	);
	assert.equal(store.jobs[0].status, "pending");
});

test("delayed earlier events block later events to preserve release ordering", async () => {
	const store = memoryStore();
	await store.accept(event);
	await store.accept({ ...event, id: "e4fa61fb-1eb1-45e2-9c58-70d4af566431" });
	store.jobs[0].next_attempt = new Date(now + 60_000).toISOString();
	const { service, calls } = fakeService();
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async () => {},
		() => now,
	).tick();
	assert.equal(calls.length, 0);
});

test("retry limit records pre-deployment failures without claiming an upload was attempted", async () => {
	const store = memoryStore();
	await store.accept(event);
	store.jobs[0].attempts = 11;
	const { service } = fakeService();
	(service as any).artifact = async () => {
		throw new Error("POM missing");
	};
	const notifications: string[] = [];
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async (text) => {
			notifications.push(text);
		},
		() => now,
	).tick();
	assert.equal(store.jobs[0].status, "failed");
	assert.equal(store.jobs[0].attempts, 12);
	assert.deepEqual(notifications, []);
});

test("HTTP receiver authenticates, validates, filters, and deduplicates in memory", async () => {
	const store = memoryStore();
	let configuredToken: string | undefined = "secret";
	const app = express();
	registerReposiliteRoute(app, store, () => configuredToken);
	const http = app.listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => http.once("listening", resolve));
	const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/reposilite`;
	async function send(payload = event, token = "secret", headerId = payload.id) {
		return (
			await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Reposilite-Event-Id": headerId },
				body: JSON.stringify(payload),
			})
		).status;
	}
	try {
		assert.equal(await send(event, "wrong"), 401);
		assert.equal(store.jobs.length, 0);
		assert.equal(await send(event, "secret", "wrong"), 400);
		assert.equal(await send({ ...event, schemaVersion: 2 } as unknown as UploadEvent), 400);
		assert.equal(await send({ ...event, path: event.path + ".sha1" }), 204);
		assert.equal(await send(), 202);
		assert.equal(store.jobs.length, 1);
		assert.equal(await send(), 200);
		assert.equal(store.jobs.length, 1);
		configuredToken = undefined;
		assert.equal(await send(), 503);
		configuredToken = "secret";
		store.accept = async () => {
			throw new Error("Queue is full");
		};
		assert.equal(await send(), 503);
	} finally {
		await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
	}
});

test("deduplication is in memory and a new store accepts an event again", async () => {
	const first = new MemoryEventStore();
	assert.equal(await first.accept(event), true);
	assert.equal(await first.accept(event), false);
	await assert.rejects(first.accept({ ...event, uploadedBy: "different" }), /different payload/);
	const restarted = new MemoryEventStore();
	assert.equal(await restarted.accept(event), true);
});

function fakeDiscord() {
	const sent: { content: string; allowedMentions: unknown }[] = [];
	const edits: { id: string; content: string }[] = [];
	const thread = {
		archived: true,
		isThread: () => true,
		isSendable: () => true,
		async setArchived(archived: boolean) {
			this.archived = archived;
		},
		async send(payload: { content: string; allowedMentions: unknown }) {
			sent.push(payload);
			return { id: `message-${sent.length}` };
		},
		messages: {
			async edit(id: string, payload: { content: string }) {
				edits.push({ id, content: payload.content });
			},
		},
	};
	const client = {
		channels: {
			async fetch(id: string) {
				assert.equal(id, DEV_UPDATE_THREAD);
				return thread;
			},
		},
	} as unknown as Client;
	return { client, thread, sent, edits };
}

test("each uploaded version gets one thread message edited across retries and new worker instances", async () => {
	const store = memoryStore();
	await store.accept(event);
	const discord = fakeDiscord();
	const notify = createDevUpdateNotifier(discord.client, store);
	const { service, calls } = fakeService();
	let fail = true;
	service.deploy = async (server, id, options) => {
		calls.push({ server, id, options });
		if (server === "dev-two" && fail) throw new Error("Upload failed");
		return { id, version: "1.0" };
	};
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	assert.equal(discord.sent.length, 1);
	assert.equal(discord.thread.archived, false);
	assert.deepEqual(discord.sent[0].allowedMentions, { parse: [] });
	assert.match(discord.edits.at(-1)!.content, /waiting to retry.*1\/2 dev server/);
	assert.equal(store.jobs[0].message_id, "message-1");
	store.jobs[0].next_attempt = new Date(now).toISOString();
	fail = false;
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	assert.equal(discord.sent.length, 1);
	assert.ok(discord.edits.every((edit) => edit.id === "message-1"));
	assert.match(discord.edits.at(-1)!.content, /Uploaded \*\*Example\*\* `1\.0` to Dev one, Dev two/);
	const nextEvent = { ...event, id: "e4fa61fb-1eb1-45e2-9c58-70d4af566431", path: event.path.replaceAll("1.0", "2.0") };
	await store.accept(nextEvent);
	(service as any).artifact = async () => ({ types: ["paper-plugin"] });
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	assert.equal(discord.sent.length, 2);
	assert.equal(discord.edits.at(-1)!.id, "message-2");
});

test("terminal failure edits the existing message, and no matching servers do not advance commit history", async () => {
	const store = memoryStore();
	await store.accept(event);
	const discord = fakeDiscord();
	const notify = createDevUpdateNotifier(discord.client, store);
	const { service } = fakeService();
	service.deploy = async () => {
		throw new Error("Upload failed");
	};
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	store.jobs[0].attempts = 11;
	store.jobs[0].next_attempt = new Date(now).toISOString();
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	assert.equal(discord.sent.length, 1);
	assert.match(discord.edits.at(-1)!.content, /failed.*12 attempts/s);
	await store.accept({ ...event, id: "e4fa61fb-1eb1-45e2-9c58-70d4af566431" });
	service.servers = async () => [];
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		notify,
		() => now,
	).tick();
	assert.equal(store.jobs[1].status, "completed");
	assert.match(discord.edits.at(-1)?.content ?? discord.sent.at(-1)!.content, /Skipped.*no matching dev servers/);
});

test("deleted update messages are replaced while transient edit failures never create duplicates", async () => {
	const store = memoryStore();
	await store.accept(event);
	const discord = fakeDiscord();
	const notify = createDevUpdateNotifier(discord.client, store);
	await notify("Starting", store.jobs[0]);
	let code = 50013;
	discord.thread.messages.edit = async () => {
		throw { code };
	};
	await assert.rejects(notify("Retrying", store.jobs[0]));
	assert.equal(discord.sent.length, 1);
	code = 10008;
	await notify("Completed", store.jobs[0]);
	assert.equal(discord.sent.length, 2);
	assert.equal(store.jobs[0].message_id, "message-2");
});

test("tracked artifacts report progress to their push instead of posting a message", async () => {
	const store = memoryStore();
	await store.accept(event);
	const { service } = fakeService();
	const source = { repository: "Team-Sneakymouse/Example", commit: "abc1234" };
	(service as any).artifact = async () => ({ types: ["paper-plugin"], source });
	const updates: { source: unknown; status: string; text: string }[] = [];
	const notifications: string[] = [];
	const tracker = {
		async artifact(given: unknown, update: { id: string; status: string; text: string }) {
			assert.equal(update.id, "Example");
			updates.push({ source: given, status: update.status, text: update.text });
			return true;
		},
	};
	await new ReposiliteWorker(
		store,
		() => service as unknown as PluginDeployment,
		async (content) => void notifications.push(content),
		() => now,
		tracker,
	).tick();
	assert.equal(store.jobs[0].status, "completed");
	assert.deepEqual(store.jobs[0].source, source);
	assert.deepEqual(
		updates.map((update) => update.status),
		["running", "success"],
	);
	assert.ok(updates.every((update) => update.source === source || JSON.stringify(update.source) === JSON.stringify(source)));
	assert.match(updates[1].text, /Uploaded \*\*Example\*\*/);
	assert.deepEqual(notifications, []);
});

test("untracked artifacts, missing source metadata and tracker failures fall back to the upload's own message", async () => {
	for (const [source, tracker] of [
		[{ repository: "Team-Sneakymouse/Example", commit: "abc1234" }, { artifact: async () => false }],
		[undefined, { artifact: async () => assert.fail("Artifacts without a source cannot match a push") }],
		[
			{ repository: "Team-Sneakymouse/Example", commit: "abc1234" },
			{
				artifact: async () => {
					throw new Error("Database unavailable");
				},
			},
		],
	] as const) {
		const store = memoryStore();
		await store.accept(event);
		const { service, calls } = fakeService();
		(service as any).artifact = async () => ({ types: ["paper-plugin"], ...(source ? { source } : {}) });
		const notifications: string[] = [];
		await new ReposiliteWorker(
			store,
			() => service as unknown as PluginDeployment,
			async (content) => void notifications.push(content),
			() => now,
			tracker,
		).tick();
		assert.equal(store.jobs[0].status, "completed");
		assert.equal(calls.length, 2, "Tracking problems never block deployment");
		assert.equal(notifications.length, 2);
		assert.match(notifications[1], /Uploaded/);
	}
});
