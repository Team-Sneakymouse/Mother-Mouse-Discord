import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { LinkAttempts, PostgresAccountStore } from "../src/AccountManagement/store.ts";

// The tables and linking functions belong to SneakyUserMeta. Set ACCOUNTS_TEST_DATABASE_URL to a disposable database
// (its sneakyusermeta and scm schemas are dropped) and SNEAKYUSERMETA_MIGRATIONS to SneakyUserMeta's
// src/main/resources/db/migrations folder.
const url = process.env.ACCOUNTS_TEST_DATABASE_URL;
const migrations = process.env.SNEAKYUSERMETA_MIGRATIONS;

async function freshSchema(sql: SQL) {
	await sql.unsafe("drop schema if exists sneakyusermeta cascade; drop schema if exists scm cascade");
	await sql.unsafe("create schema sneakyusermeta; create schema scm");
	// What SneakyUserMeta's first script requires from SneakyCharacterManager.
	await sql.unsafe("create table scm.characters (owner_id uuid not null, character_id uuid not null unique, primary key (owner_id, character_id))");
	const scripts = readdirSync(migrations!)
		.filter((name) => /^V\d+__.+\.sql$/.test(name))
		.sort((a, b) => Number(a.slice(1, a.indexOf("__"))) - Number(b.slice(1, b.indexOf("__"))));
	for (const script of scripts) await sql.begin((tx) => tx.unsafe(readFileSync(join(migrations!, script), "utf8")));
}

/** A token made in Minecraft, as SneakyUserMeta's /link does it. */
async function minecraftToken(sql: SQL, uuid: string, name: string): Promise<string> {
	const [row] = await sql<Array<{ token: string }>>`select token from sneakyusermeta.link_token_for_account(${uuid}::uuid, ${name})`;
	return row.token;
}

/** Every field explicitly: Bun would otherwise fill gaps from PG* variables, e.g. from a local .env. */
function connect(): SQL {
	const target = new URL(url!);
	return new SQL({
		hostname: target.hostname,
		port: Number(target.port || 5432),
		username: decodeURIComponent(target.username),
		password: decodeURIComponent(target.password),
		database: target.pathname.slice(1),
	});
}

test("AccountStore links, switches mains, unlinks and connects Twitch through SneakyUserMeta's functions", { skip: !url || !migrations }, async () => {
	const sql = connect();
	try {
		await freshSchema(sql);
		const store = new PostgresAccountStore(sql);

		const user = await store.userForDiscord("111", "Someone");
		assert.equal(await store.userForDiscord("111", "Renamed"), user);
		assert.deepEqual(await store.accounts(user), []);
		assert.equal(await store.twitch(user), null);

		const token = await store.linkTokenForUser(user);
		assert.match(token, /^[0-9]{5}$/);
		assert.equal(await store.linkTokenForUser(user), token);
		assert.equal((await store.redeemForUser(token, user)).status, "wrong_side");

		const main = randomUUID();
		const alt = randomUUID();
		const first = await store.redeemForUser(await minecraftToken(sql, main, "MainName"), user);
		assert.deepEqual(first, { status: "ok", account: { uuid: main, name: "MainName", isMain: true } });
		const second = await store.redeemForUser(await minecraftToken(sql, alt, "AltName"), user);
		assert.equal(second.account?.isMain, false);
		const other = await store.userForDiscord("222", "Other");
		assert.equal((await store.redeemForUser(await minecraftToken(sql, randomUUID(), "X"), other)).status, "ok");

		const accounts = await store.accounts(user);
		assert.deepEqual(
			accounts.map((a) => [a.uuid, a.name, a.isMain]),
			[
				[main, "MainName", true],
				[alt, "AltName", false],
			],
		);
		assert.ok(accounts[0].firstSeen instanceof Date);

		assert.equal(await store.setMain(user, main), "already_main");
		assert.equal(await store.setMain(other, alt), "not_linked");
		assert.equal(await store.setMain(user, alt), "ok");

		assert.deepEqual(await store.unlink(other, alt), { status: "not_linked", accountName: undefined, newMain: undefined });
		assert.deepEqual(await store.unlink(user, alt), { status: "ok", accountName: "AltName", newMain: { uuid: main, name: "MainName" } });
		assert.deepEqual(await store.unlink(user, main), { status: "ok", accountName: "MainName", newMain: undefined });
		assert.deepEqual(await store.accounts(user), []);

		const grant = { accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() + 3600_000), scopes: ["chat:read", "user:read:email"] };
		assert.deepEqual(await store.linkTwitch(user, { twitchId: "42", displayName: "Streamer", profileImageUrl: "" }, grant), { moved: false });
		assert.deepEqual(await store.twitch(user), { twitchId: "42", displayName: "Streamer", profileImageUrl: "" });
		const [tokens] = await sql<Array<{ scopes: string[] }>>`select scopes from sneakyusermeta.twitch_tokens where twitch_id = '42'`;
		assert.deepEqual([...tokens.scopes], ["chat:read", "user:read:email"]);
		assert.deepEqual(await store.linkTwitch(other, { twitchId: "42", displayName: "Streamer", profileImageUrl: "" }, { ...grant, scopes: [] }), {
			moved: true,
		});
		assert.equal(await store.twitch(user), null);
		assert.equal(await store.unlinkTwitch(other), true);
		assert.equal(await store.unlinkTwitch(other), false);
	} finally {
		await sql.close();
	}
});

test("AccountStore finds a Discord user's main account and the accounts seen recently", { skip: !url || !migrations }, async () => {
	const sql = connect();
	try {
		await freshSchema(sql);
		const store = new PostgresAccountStore(sql);
		const user = await store.userForDiscord("111", "Someone");
		assert.equal(await store.mainAccountForDiscord("111"), null);

		const main = randomUUID();
		const alt = randomUUID();
		const stale = randomUUID();
		await store.redeemForUser(await minecraftToken(sql, main, "MainName"), user);
		await store.redeemForUser(await minecraftToken(sql, alt, "AltName"), user);
		await minecraftToken(sql, stale, "StaleName"); // an account row that nobody linked
		await sql`update sneakyusermeta.accounts set last_seen = now() - interval '20 days' where uuid = ${stale}::uuid`;

		assert.deepEqual(await store.mainAccountForDiscord("111"), { uuid: main, name: "MainName" });
		assert.equal(await store.mainAccountForDiscord("222"), null);
		const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
		assert.deepEqual(
			(await store.accountsSeenSince(since)).map((a) => a.name),
			["AltName", "MainName"],
		);
	} finally {
		await sql.close();
	}
});

test("LinkAttempts blocks after too many wrong tokens until they age out", () => {
	let now = 0;
	const attempts = new LinkAttempts(2, 1000, () => now);
	attempts.failed("a");
	assert.equal(attempts.blocked("a"), false);
	now = 500;
	attempts.failed("a");
	assert.equal(attempts.blocked("a"), true);
	assert.equal(attempts.blocked("b"), false);
	now = 1000;
	assert.equal(attempts.blocked("a"), false);
});
