import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "discord.js";
import type PocketBase from "pocketbase";
import { LeaderboardRewardsManager } from "../src/LeaderboardRewards.ts";

type Score = Parameters<LeaderboardRewardsManager["formatLeaderboardContent"]>[0][number];
type Settings = Parameters<LeaderboardRewardsManager["distributeRewards"]>[0];
type Mail = { recipient_uuid: string; note: string; rewards: { type: string; command: string }[] };

function score(name: string, value: number, leaderboard = "leaderboard"): Score {
	return { id: name, collectionId: "scores", collectionName: "lom2_leaderboards", account: name, name, value, leaderboard, date: "2026-10-07" };
}

function setup(rewards: Settings["value"]["rewards"] = {}) {
	const mails: Mail[] = [];
	const db = {
		collection(name: string) {
			assert.equal(name, "lom2_mail");
			return {
				async create(mail: Mail) {
					mails.push(mail);
					return { id: String(mails.length), ...mail };
				},
			};
		},
	} as unknown as PocketBase;
	const manager = new LeaderboardRewardsManager({} as Client, db);
	const settings = { value: { weekdays: ["Wednesday"], rewards } } as Settings;
	return { manager, settings, mails };
}

const date = new Date("2026-10-07T12:00:00Z");

test("tied second-place scores both receive second-place reward mail, skipping third place", async () => {
	const { manager, settings, mails } = setup({ leaderboard: { "1": "gold", "2": "silver", "3": "bronze", "4+": "participation" } });
	await manager.distributeRewards(settings, { leaderboard: [score("D", 600), score("B", 800), score("A", 1000), score("C", 800)] }, date);
	assert.deepEqual(
		mails.map((mail) => [mail.recipient_uuid, mail.rewards[0].command, mail.note.match(/<yellow>(.*?)<\/yellow>/)?.[1]]),
		[
			["A", "ms cast as {player} gold", "1st"],
			["B", "ms cast as {player} silver", "2nd"],
			["C", "ms cast as {player} silver", "2nd"],
			["D", "ms cast as {player} participation", "4th"],
		],
	);
});

test("leaderboard text preserves shared ranks with escaped dots through tenth place", () => {
	const { manager } = setup();
	const scores = [
		score("A", 1000),
		score("B", 800),
		score("C", 800),
		...[700, 600, 500, 400, 300, 200, 100].map((value, i) => score(String.fromCharCode(68 + i), value)),
	];
	assert.equal(
		manager.formatLeaderboardContent([...scores.slice(3), ...scores.slice(0, 3)]),
		"1\\. **A: 1,000**\n2\\. B: **800**\n2\\. C: **800**\n4\\. D: **700**\n5\\. E: **600**\n6\\. F: **500**\n7\\. G: **400**\n8\\. H: **300**\n9\\. I: **200**\n10\\. J: **100**",
	);
});

for (const { name, values, ranks } of [
	{ name: "tied first place", values: [100, 100, 90], ranks: [1, 1, 3] },
	{ name: "three-way ties", values: [100, 90, 90, 90, 80], ranks: [1, 2, 2, 2, 5] },
	{ name: "multiple tied groups", values: [100, 100, 90, 90, 80], ranks: [1, 1, 3, 3, 5] },
	{ name: "distinct scores", values: [100, 90, 80], ranks: [1, 2, 3] },
	{ name: "nearby unequal scores", values: [100, 99.9, 99.8], ranks: [1, 2, 3] },
]) {
	test(`reward ranks handle ${name}`, async () => {
		const { manager, settings, mails } = setup({ leaderboard: { "1+": "reward" } });
		const scores = values.map((value, i) => score(String(i), value));
		await manager.distributeRewards(settings, { leaderboard: scores }, date);
		assert.deepEqual(
			mails.map((mail) => mail.note.match(/<yellow>(.*?)<\/yellow>/)?.[1]),
			ranks.map((rank) => manager.getOrdinal(rank)),
		);
	});
}

test("a tie crossing the last rewarded position rewards both accounts", async () => {
	const { manager, settings, mails } = setup({ leaderboard: { "1-2": "reward" } });
	await manager.distributeRewards(settings, { leaderboard: [score("A", 100), score("B", 90), score("C", 90), score("D", 80)] }, date);
	assert.deepEqual(
		mails.map((mail) => mail.recipient_uuid),
		["A", "B", "C"],
	);
});

test("ranks are independent for each leaderboard and retain overlapping rewards", async () => {
	const { manager, settings, mails } = setup({ leaderboard: { "1": "gold", "1+": "participation" }, other: { "1": "otherGold" } });
	await manager.distributeRewards(settings, { leaderboard: [score("A", 100), score("B", 100)], other: [score("C", 50, "other")] }, date);
	assert.deepEqual(
		mails.map((mail) => mail.rewards.map((reward) => reward.command)),
		[
			["ms cast as {player} gold", "ms cast as {player} participation"],
			["ms cast as {player} gold", "ms cast as {player} participation"],
			["ms cast as {player} otherGold"],
		],
	);
});

test("display highlights all tied winners and retains the 16-entry limit", () => {
	const { manager } = setup();
	const scores = Array.from({ length: 17 }, (_, i) => score(String(i), i < 2 ? 100 : 100 - i));
	const lines = manager.formatLeaderboardContent(scores).split("\n");
	assert.equal(lines.length, 16);
	assert.equal(lines[0], "1\\. **0: 100**");
	assert.equal(lines[1], "1\\. **1: 100**");
	assert.equal(lines[2], "3\\. 2: **98**");
	assert.equal(lines[15], "16\\. 15: **85**");
});

test("empty leaderboards produce no display text or reward mail", async () => {
	const { manager, settings, mails } = setup({ leaderboard: { "1+": "reward" } });
	assert.equal(manager.formatLeaderboardContent([]), "");
	await manager.distributeRewards(settings, { leaderboard: [] }, date);
	assert.deepEqual(mails, []);
});
