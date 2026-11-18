import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresMailSender, SourceKeyReusedError, type RewardMail } from "../src/utils/SneakyMail.ts";
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
