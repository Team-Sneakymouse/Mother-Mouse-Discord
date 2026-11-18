import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "discord.js";
import type PocketBase from "pocketbase";
import type { AccountStore } from "../src/AccountManagement/store.ts";
import { awardDragoncoins } from "../src/ReactionRewards.ts";
import { PostgresMailSender } from "../src/utils/SneakyMail.ts";
import { fakeSneakyMailSql } from "./fakeSneakyMail.ts";

const MAIN = { uuid: "00000000-0000-0000-0000-00000000000a", name: "Mainy" };

function setup(main: { uuid: string; name: string } | null = MAIN) {
	const fake = fakeSneakyMailSql();
	const settingsUpdates: unknown[][] = [];
	const db = {
		collection(name: string) {
			assert.equal(name, "settings");
			return {
				async update(...args: unknown[]) {
					settingsUpdates.push(args);
				},
			};
		},
	} as unknown as PocketBase;
	const accounts = {
		async mainAccountForDiscord(discordId: string) {
			assert.equal(discordId, "222");
			return main;
		},
	} as unknown as AccountStore;
	const dms: string[] = [];
	const author = {
		id: "222",
		tag: "author",
		dmChannel: {
			async send(text: string) {
				dms.push(text);
			},
		},
	} as unknown as User;
	return { ...fake, mail: new PostgresMailSender(fake.sql), db, accounts, author, dms, settingsUpdates };
}

async function captureErrors(action: (errors: unknown[][]) => Promise<void>) {
	const errors: unknown[][] = [];
	const originalError = console.error;
	console.error = (...args) => {
		errors.push(args);
	};
	try {
		await action(errors);
	} finally {
		console.error = originalError;
	}
}

test("a red gem mails 100 Dragon Coins to the author's main account, keyed by the message", async () => {
	const { db, accounts, mail, author, sent, settingsUpdates } = setup();
	await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
	assert.equal(sent.length, 1);
	assert.equal(sent[0].sourceKey, "reaction:red-gem:1300000000000000001");
	assert.equal(sent[0].recipientUuid, MAIN.uuid);
	assert.equal(sent[0].senderName, "<gold>Grand Paladin Order</gold>");
	assert.match(sent[0].note, /100 Dragon Coins/);
	assert.deepEqual(sent[0].rewards, [{ type: "command", command: "ms cast as {player} mail-redGemReward" }]);
	assert.equal(settingsUpdates.length, 1);
	assert.equal(settingsUpdates[0][0], "p6989yx87943q9y");
});

test("the same message rewarded again sends no second mail; another message does", async () => {
	const { db, accounts, mail, author, sent } = setup();
	await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
	await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
	assert.equal(sent.length, 1);
	await awardDragoncoins(db, accounts, mail, author, "1300000000000000002");
	assert.deepEqual(
		sent.map((m) => m.sourceKey),
		["reaction:red-gem:1300000000000000001", "reaction:red-gem:1300000000000000002"],
	);
});

test("a reused key with another recipient is logged and leaves the reminder timestamp alone", async () => {
	const first = setup();
	await awardDragoncoins(first.db, first.accounts, first.mail, first.author, "1300000000000000001");
	const switched = { uuid: "00000000-0000-0000-0000-00000000000b", name: "Alty" };
	const accounts = { mainAccountForDiscord: async () => switched } as unknown as AccountStore;
	await captureErrors(async (errors) => {
		await awardDragoncoins(first.db, accounts, first.mail, first.author, "1300000000000000001");
		assert.equal(errors.length, 1);
		assert.equal(
			errors[0][0],
			`ReactionRewards: red gem for message 1300000000000000001 (source key reaction:red-gem:1300000000000000001): no Dragon Coins sent to Alty (${switched.uuid}): the key already names a mail with different content`,
		);
	});
	assert.equal(first.sent.length, 1);
	assert.equal(first.settingsUpdates.length, 1);
});

test("an author without a linked account is told how to link one and gets no mail", async () => {
	const { db, accounts, mail, author, sent, dms, settingsUpdates } = setup(null);
	await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
	assert.equal(sent.length, 0);
	assert.equal(settingsUpdates.length, 0);
	assert.equal(dms.length, 1);
	assert.match(dms[0], /`\/accounts`/);
});

test("without a PostgreSQL connection nothing is sent", async () => {
	const { db, accounts, author, settingsUpdates } = setup();
	await captureErrors(async (errors) => {
		await awardDragoncoins(db, accounts, null, author, "1300000000000000001");
		assert.deepEqual(errors, [
			[
				"ReactionRewards: no PostgreSQL database (PGHOST unset); no Dragon Coins sent for red gem for message 1300000000000000001 (source key reaction:red-gem:1300000000000000001)",
			],
		]);
	});
	assert.equal(settingsUpdates.length, 0);
});

test("a database outage while looking up the account is logged, not thrown", async () => {
	const { db, mail, author, sent } = setup();
	const outage = new Error("connection refused");
	const accounts = {
		async mainAccountForDiscord() {
			throw outage;
		},
	} as unknown as AccountStore;
	await captureErrors(async (errors) => {
		await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
		assert.deepEqual(errors, [
			[
				"ReactionRewards: red gem for message 1300000000000000001 (source key reaction:red-gem:1300000000000000001): no Dragon Coins sent: looking up the author's main account failed",
				outage,
			],
		]);
	});
	assert.equal(sent.length, 0);
});

test("a failed send logs the statement to resend it by hand", async () => {
	const failure = new Error("simulated");
	const fake = fakeSneakyMailSql(() => {
		throw failure;
	});
	const { db, accounts, author, settingsUpdates } = setup();
	await captureErrors(async (errors) => {
		await awardDragoncoins(db, accounts, new PostgresMailSender(fake.sql), author, "1300000000000000001");
		assert.equal(errors.length, 1);
		const [message, error] = errors[0] as [string, unknown];
		assert.equal(error, failure);
		assert.ok(
			message.startsWith(
				`ReactionRewards: red gem for message 1300000000000000001 (source key reaction:red-gem:1300000000000000001): no Dragon Coins sent to Mainy (${MAIN.uuid}). Resend by hand: select sneakymail.send('reaction:red-gem:1300000000000000001', '${MAIN.uuid}'::uuid, `,
			),
			message,
		);
	});
	assert.equal(settingsUpdates.length, 0);
});

test("a PocketBase failure after the mail went out is logged as sent", async () => {
	const { accounts, mail, author, sent } = setup();
	const outage = new Error("PocketBase down");
	const db = {
		collection: () => ({
			async update() {
				throw outage;
			},
		}),
	} as unknown as PocketBase;
	await captureErrors(async (errors) => {
		await awardDragoncoins(db, accounts, mail, author, "1300000000000000001");
		assert.deepEqual(errors, [
			[
				`ReactionRewards: red gem for message 1300000000000000001 (source key reaction:red-gem:1300000000000000001): Dragon Coins sent to Mainy (${MAIN.uuid}), but updating the reminder timestamp failed`,
				outage,
			],
		]);
	});
	assert.equal(sent.length, 1);
});
