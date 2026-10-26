import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deliver, deliveryStore, startPolling } from "../src/JobDelivery.ts";

test("ack failure reconciles previously sent message without reposting", async () => {
	const effects: string[] = [];
	let attempted = false;
	let message: string | undefined;
	const io = {
		lookup: async () => message,
		reserve: async () => {
			if (attempted) return false;
			attempted = true;
			return true;
		},
		send: async () => {
			effects.push("send");
			message = "123";
			return message;
		},
		ack: async () => {
			effects.push("ack");
			if (effects.length === 2) throw Error("offline");
		},
	};
	await assert.rejects(deliver(io));
	await deliver(io);
	assert.deepEqual(effects, ["send", "ack", "ack"]);
});
test("uncertain send cannot resend after restart, even if history cannot find it", async () => {
	const dir = await mkdtemp(join(tmpdir(), "job-delivery-"));
	try {
		const a = await deliveryStore(dir);
		assert.equal(await a.reserve("abcdefghijklmno"), true);
		const b = await deliveryStore(dir);
		assert.equal(await b.reserve("abcdefghijklmno"), false);
		let sends = 0;
		await assert.rejects(
			deliver({
				lookup: async () => undefined,
				reserve: () => b.reserve("abcdefghijklmno"),
				send: async () => {
					sends++;
					return "1";
				},
				ack: async () => {},
			}),
			/manual reconciliation/,
		);
		assert.equal(sends, 0);
		await a.save("abcdefghijklmno", "123");
		assert.equal(await b.lookup("abcdefghijklmno"), "123");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
test("polls never overlap, failure retries, and stop cancels future polling", async () => {
	let resolve!: () => void;
	let calls = 0;
	let finished = 0;
	const stop = startPolling(
		async () => {
			calls++;
			await new Promise<void>((r) => {
				resolve = r;
			});
			finished++;
		},
		() => {},
		5,
	);
	await new Promise((r) => setTimeout(r, 25));
	assert.equal(calls, 1);
	resolve();
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(calls, 2);
	const done = stop();
	resolve();
	await done;
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(calls, 2);
	assert.equal(finished, 2);
});
