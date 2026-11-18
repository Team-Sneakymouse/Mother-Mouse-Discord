import assert from "node:assert/strict";
import { test } from "node:test";
import { SQL } from "bun";
import { PostgresMailSender, resendStatement, SourceKeyReusedError, type RewardMail } from "../src/utils/SneakyMail.ts";
import { fakeSneakyMailSql } from "./fakeSneakyMail.ts";

const mail: RewardMail = {
	sourceKey: "leaderboard:leaderboard:2026-10-07:00000000-0000-0000-0000-000000000001",
	recipientUuid: "00000000-0000-0000-0000-000000000001",
	senderName: "<gold>Grand Paladin Order</gold>",
	note: "Congratulations!",
	rewards: [{ type: "command", command: "ms cast as {player} gold" }],
};

test("send calls sneakymail.send with the contract's six arguments and returns the id", async () => {
	const { sql, queries } = fakeSneakyMailSql();
	assert.equal(await new PostgresMailSender(sql).send(mail), "1");
	assert.equal(queries.length, 1);
	assert.equal(queries[0].text.replace(/\s+/g, " ").trim(), "select sneakymail.send($, $::uuid, $, $, $::jsonb, $::timestamptz)::text as id");
	assert.deepEqual(queries[0].values, [
		mail.sourceKey,
		mail.recipientUuid,
		mail.senderName,
		mail.note,
		// The array itself, not JSON text: Bun would encode a string a second time.
		[{ type: "command", command: "ms cast as {player} gold" }],
		null,
	]);
});

test("sending the same key and content again returns the existing mail", async () => {
	const { sql, sent } = fakeSneakyMailSql();
	const sender = new PostgresMailSender(sql);
	const first = await sender.send(mail);
	assert.equal(await sender.send(structuredClone(mail)), first);
	assert.equal(sent.length, 1);
});

test("a key reused with different content rejects with SourceKeyReusedError", async () => {
	const { sql, sent } = fakeSneakyMailSql();
	const sender = new PostgresMailSender(sql);
	await sender.send(mail);
	const error = await sender.send({ ...mail, note: "You placed 2nd" }).then(
		() => assert.fail("expected a rejection"),
		(e: unknown) => e,
	);
	assert.ok(error instanceof SourceKeyReusedError);
	assert.equal(error.sourceKey, mail.sourceKey);
	assert.equal((error.cause as { errno?: string }).errno, "23505");
	assert.equal(sent.length, 1);
});

test("other database errors pass through unchanged", async () => {
	const failure = Object.assign(new Error('invalid input syntax for type uuid: "nope"'), { errno: "22P02" });
	const { sql } = fakeSneakyMailSql(() => {
		throw failure;
	});
	await assert.rejects(new PostgresMailSender(sql).send({ ...mail, recipientUuid: "nope" }), (e) => e === failure);
});

function serverError(errno: string, message = "simulated") {
	return new SQL.PostgresError(message, { code: "ERR_POSTGRES_SERVER_ERROR", errno });
}

/** A sender whose first `failures` calls throw, with recorded instead of real waits. */
function flaky(failures: unknown[]) {
	const waits: number[] = [];
	let calls = 0;
	const fake = fakeSneakyMailSql(() => {
		calls++;
		const failure = failures.shift();
		if (failure) throw failure;
	});
	const sender = new PostgresMailSender(fake.sql, { delaysMs: [1000, 5000], sleep: async (ms) => void waits.push(ms) });
	return { sender, waits, calls: () => calls, sent: fake.sent };
}

async function captureWarnings(action: (warnings: unknown[][]) => Promise<void>) {
	const warnings: unknown[][] = [];
	const originalWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args);
	};
	try {
		await action(warnings);
	} finally {
		console.warn = originalWarn;
	}
}

test("connection errors and serialization failures are retried with backoff, then the mail is sent once", async () => {
	const refused = new SQL.PostgresError("Failed to connect", { code: "ERR_POSTGRES_CONNECTION_REFUSED" });
	const { sender, waits, calls, sent } = flaky([refused, serverError("40001")]);
	await captureWarnings(async (warnings) => {
		assert.equal(await sender.send(mail), "1");
		assert.deepEqual(
			warnings.map(([message]) => message),
			[
				`SneakyMail: sending ${mail.sourceKey} failed (ERR_POSTGRES_CONNECTION_REFUSED); retrying in 1000 ms`,
				`SneakyMail: sending ${mail.sourceKey} failed (40001); retrying in 5000 ms`,
			],
		);
	});
	assert.deepEqual(waits, [1000, 5000]);
	assert.equal(calls(), 3);
	assert.equal(sent.length, 1);
});

test("a send that keeps failing gives up after the last retry with the last error", async () => {
	const last = serverError("57P01", "terminating connection due to administrator command");
	const { sender, waits, calls } = flaky([serverError("08006"), serverError("57P01"), last]);
	await captureWarnings(async () => {
		await assert.rejects(sender.send(mail), (e) => e === last);
	});
	assert.deepEqual(waits, [1000, 5000]);
	assert.equal(calls(), 3);
});

for (const [name, failure] of [
	["a reused key (23505)", serverError("23505")],
	["bad data (22P02)", serverError("22P02")],
	["a missing sneakymail.send (42883)", serverError("42883")],
	["an error that isn't from the database", new TypeError("simulated")],
] as const) {
	test(`${name} is not retried`, async () => {
		const { sender, waits, calls } = flaky([failure]);
		await assert.rejects(sender.send(mail));
		assert.deepEqual(waits, []);
		assert.equal(calls(), 1);
	});
}

test("the resend statement quotes the logged mail's key and content", () => {
	assert.equal(
		resendStatement({ ...mail, note: "Rawb's gem\nline two" }),
		`select sneakymail.send('${mail.sourceKey}', '${mail.recipientUuid}'::uuid, '<gold>Grand Paladin Order</gold>', 'Rawb''s gem\nline two', '[{"type":"command","command":"ms cast as {player} gold"}]'::jsonb, null);`,
	);
});
