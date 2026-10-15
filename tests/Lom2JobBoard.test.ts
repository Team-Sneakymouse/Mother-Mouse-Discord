import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { ChannelType, type Client } from "discord.js";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import Lom2JobBoard from "../src/Lom2JobBoard.ts";

function setup() {
	const effects: string[] = [];
	const message = {
		id: "message",
		embeds: [{ title: "Job" }],
		async edit() {
			effects.push("edit");
		},
		async delete() {
			effects.push("delete");
		},
	};
	const channel = {
		type: ChannelType.GuildText,
		isDMBased: () => false,
		isTextBased: () => true,
		async send() {
			effects.push("send");
			return message;
		},
		messages: {
			async fetch() {
				effects.push("fetch-message");
				return message;
			},
		},
	};
	const client = Object.assign(new EventEmitter(), {
		isReady: () => true,
		guilds: { cache: new Map() },
		channels: {
			cache: new Map(),
			async fetch() {
				effects.push("fetch-channel");
				return channel;
			},
		},
	});
	let onEvent: (event: { action: string; record: RecordModel }) => void;
	const db = {
		collection(name: string) {
			assert.equal(name, "lom2_listed_jobs");
			return {
				async subscribe(topic: string, callback: typeof onEvent) {
					assert.equal(topic, "*");
					onEvent = callback;
				},
				async update() {
					effects.push("update-record");
				},
			};
		},
	};
	Lom2JobBoard(client as unknown as Client, db as unknown as PocketBase);
	client.emit("clientReady");
	return {
		effects,
		async emit(action: string, serverPort: number | undefined, endReason = "expired") {
			const record = {
				id: "job",
				collectionId: "jobs",
				collectionName: "lom2_listed_jobs",
				category: "Test",
				posterDisplayString: "Poster",
				posterIconBase64: "data:image/png;base64,aWNvbg==",
				location: "Location{world=CraftWorld{name=world},x=1.0,y=2.0,z=3.0}",
				locationDisplayString: "Location",
				startTime: 1000,
				name: "Job",
				description: "Description",
				discordEmbedIcon: "https://example.com/icon.png",
				discordMessageId: "message",
				endTime: 2000,
				endReason,
				...(serverPort === undefined ? {} : { serverPort }),
			};
			onEvent({ action, record });
			// Drain async post/expire work launched by the subscription callback.
			await new Promise<void>((resolve) => setImmediate(resolve));
		},
	};
}

test("non-live job creates have no Discord or PocketBase effects", async () => {
	const fixture = setup();
	await fixture.emit("create", 50002);
	assert.deepEqual(fixture.effects, []);
});

for (const port of [1, 50000, 50002, 65535, -1]) {
	for (const endReason of ["expired", "deleted"]) {
		test(`non-live port ${port} ignores ${endReason} updates`, async () => {
			const fixture = setup();
			await fixture.emit("update", port, endReason);
			assert.deepEqual(fixture.effects, []);
		});
	}
}

for (const port of [50001, 0, undefined]) {
	test(`port ${port} still posts new jobs and stores the message ID`, async () => {
		const fixture = setup();
		await fixture.emit("create", port);
		assert.deepEqual(fixture.effects, ["fetch-channel", "send", "update-record"]);
	});

	test(`port ${port} still expires existing messages`, async () => {
		const fixture = setup();
		await fixture.emit("update", port);
		assert.deepEqual(fixture.effects, ["fetch-channel", "fetch-message", "edit"]);
	});

	test(`port ${port} still deletes removed jobs`, async () => {
		const fixture = setup();
		await fixture.emit("update", port, "deleted");
		assert.deepEqual(fixture.effects, ["fetch-channel", "fetch-message", "delete"]);
	});
}
