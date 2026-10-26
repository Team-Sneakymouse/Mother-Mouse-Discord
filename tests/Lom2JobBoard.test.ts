import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType, type Client, type TextChannel } from "discord.js";
import { EventEmitter } from "node:events";
import { parseClaim, hooksConfig, hooksApi, type Claim } from "../src/JobHooks.ts";
import Lom2JobBoard, { processJobClaim } from "../src/Lom2JobBoard.ts";
import type { DeliveryStore } from "../src/JobDelivery.ts";
const job = {
	id: "abcdefghijklmno",
	serverPort: 50001 as const,
	category: "Test",
	posterDisplayString: "Poster",
	posterIconBase64: "data:image/png;base64,aWNvbg==",
	location: "Location{world=CraftWorld{name=world},x=1,y=2,z=3}",
	locationDisplayString: "Place",
	startTime: 1000,
	name: "Job",
	description: "Description",
	discordEmbedIcon: "https://example.com/icon.png",
	discordMessageId: "",
	endTime: 0,
	endReason: "",
};
const claim = (kind: "create" | "end" = "create"): Claim => ({
	eventId: "1",
	leaseToken: "12345678-1234-1234-1234-123456789012",
	kind,
	job: { ...job, ...(kind === "end" ? { endTime: 2000 } : {}) },
});
function fixture() {
	const effects: string[] = [];
	let known: string | undefined;
	let reserved = false;
	let missing = false;
	let sent: any;
	let edited: any;
	let acks = 0;
	let failAck = false;
	let historyOnly = false;
	const message = {
		id: "123",
		author: { id: "bot" },
		content: `[lom-job:${job.id}]`,
		embeds: [{ title: "Job" }],
		edit: async (data: any) => {
			effects.push("edit");
			edited = data;
		},
		delete: async () => {
			effects.push("delete");
		},
	};
	const channel = {
		type: ChannelType.GuildText,
		messages: {
			fetch: async (input: any) => {
				if (typeof input === "object") return new Map(known || historyOnly ? [[message.id, message]] : []);
				if (missing) throw Object.assign(Error("Unknown Message"), { code: 10008 });
				return message;
			},
		},
		send: async (data: any) => {
			effects.push("send");
			sent = data;
			return message;
		},
	} as unknown as TextChannel;
	const store: DeliveryStore = {
		reserve: async () => {
			if (reserved) return false;
			reserved = true;
			return true;
		},
		lookup: async () => known,
		save: async (_id, id) => {
			known = id;
		},
	};
	const ack = async () => {
		acks++;
		if (failAck) throw Error("offline");
	};
	return {
		effects,
		channel,
		store,
		ack,
		get sent() {
			return sent;
		},
		get edited() {
			return edited;
		},
		get acks() {
			return acks;
		},
		set failAck(v: boolean) {
			failAck = v;
		},
		set missing(v: boolean) {
			missing = v;
		},
		set historyOnly(v: boolean) {
			historyOnly = v;
		},
	};
}
test("claim rejects foreign/legacy ports and malformed payloads", () => {
	for (const port of [0, undefined, null, 50002, 50001.1])
		assert.throws(() => parseClaim({ items: [{ ...claim(), job: { ...job, serverPort: port } }], hasMore: false }));
	assert.equal(parseClaim({ items: [claim()], hasMore: false }).items.length, 1);
	for (const input of [{}, { items: [], hasMore: 1 }, { items: [{}], hasMore: false }]) assert.throws(() => parseClaim(input));
});
test("HTTPS configuration fails closed without secret and durable state", () => {
	for (const env of [
		{},
		{ JOBBOARD_HOOKS_URL: "http://example.com", JOBBOARD_INTERNAL_SECRET: "s", JOBBOARD_STATE_DIR: "/state" },
		{ JOBBOARD_HOOKS_URL: "https://example.com/path", JOBBOARD_INTERNAL_SECRET: "s", JOBBOARD_STATE_DIR: "/state" },
		{ JOBBOARD_HOOKS_URL: "https://example.com", JOBBOARD_INTERNAL_SECRET: " ", JOBBOARD_STATE_DIR: "/state" },
		{ JOBBOARD_HOOKS_URL: "https://example.com", JOBBOARD_INTERNAL_SECRET: "s", JOBBOARD_STATE_DIR: "relative" },
	])
		assert.throws(() => hooksConfig(env));
});
test("create preserves map/image/embed and marker; ack retry never resends", async () => {
	const f = fixture();
	f.failAck = true;
	await assert.rejects(processJobClaim(claim(), f.channel, f.store, f.ack, "bot"));
	assert.equal(f.sent.content, `[lom-job:${job.id}]`);
	assert.match(f.sent.embeds[0].data.url, /worldname=world/);
	assert.equal(f.sent.files[0].name, "posterIcon.png");
	f.failAck = false;
	await processJobClaim(claim(), f.channel, f.store, f.ack, "bot");
	assert.deepEqual(f.effects, ["send"]);
	assert.equal(f.acks, 2);
});
test("create then end preserves ordering and expired attachment without map", async () => {
	const f = fixture();
	await processJobClaim(claim(), f.channel, f.store, f.ack, "bot");
	await processJobClaim(claim("end"), f.channel, f.store, f.ack, "bot");
	assert.deepEqual(f.effects, ["send", "edit"]);
	assert.equal(f.edited.embeds[0].data.url, undefined);
	assert.equal(f.edited.embeds[0].data.thumbnail.url, "attachment://posterIcon.png");
	assert.equal(f.edited.embeds[0].data.author.name, "Test (Expired)");
});
test("deleted and already missing end messages acknowledge without repost", async () => {
	const f = fixture();
	const item = claim("end");
	item.job.discordMessageId = "123";
	item.job.endReason = "deleted";
	await processJobClaim(item, f.channel, f.store, f.ack, "bot");
	assert.deepEqual(f.effects, ["delete"]);
	f.missing = true;
	await processJobClaim(item, f.channel, f.store, f.ack, "bot");
	assert.equal(f.acks, 2);
	assert.deepEqual(f.effects, ["delete"]);
});
test("foreign job and stopped lifecycle cannot perform Discord effects", async () => {
	const f = fixture();
	const item = claim();
	(item.job as any).serverPort = 0;
	await assert.rejects(processJobClaim(item, f.channel, f.store, f.ack, "bot"));
	assert.deepEqual(f.effects, []);
	await assert.rejects(
		processJobClaim(claim(), f.channel, f.store, f.ack, "bot", () => {
			throw Error("Stopped");
		}),
	);
	assert.deepEqual(f.effects, []);
});
test("startup configuration failure is explicit even for an already-ready client", () => {
	const client = Object.assign(new EventEmitter(), { isReady: () => true }) as unknown as Client;
	assert.throws(() => Lom2JobBoard(client, {}));
});

test("stop before Discord readiness removes startup handler without claims", async () => {
	const client = Object.assign(new EventEmitter(), { isReady: () => false }) as unknown as Client;
	const stop = Lom2JobBoard(client, {
		JOBBOARD_HOOKS_URL: "https://hooks.example",
		JOBBOARD_INTERNAL_SECRET: "secret",
		JOBBOARD_STATE_DIR: "/unused-test-state",
	});
	assert.equal(client.listenerCount("clientReady"), 1);
	await stop();
	assert.equal(client.listenerCount("clientReady"), 0);
	(client as unknown as EventEmitter).emit("clientReady");
});

test("marker recovered from bounded history is durably remembered before ack", async () => {
	const f = fixture();
	f.historyOnly = true;
	f.failAck = true;
	await assert.rejects(processJobClaim(claim(), f.channel, f.store, f.ack, "bot"));
	f.historyOnly = false;
	f.failAck = false;
	await processJobClaim(claim(), f.channel, f.store, f.ack, "bot");
	assert.deepEqual(f.effects, []);
});
