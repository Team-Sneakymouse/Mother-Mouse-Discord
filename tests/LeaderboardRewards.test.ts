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

async function captureLogs(action: (logs: unknown[][], errors: unknown[][]) => Promise<void>) {
	const logs: unknown[][] = [],
		errors: unknown[][] = [];
	const originalLog = console.log,
		originalError = console.error;
	console.log = (...args) => {
		logs.push(args);
	};
	console.error = (...args) => {
		errors.push(args);
	};
	try {
		await action(logs, errors);
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}
}

test("manager retains failed-parse error logging and continues with valid rules", async () => {
	const { manager, settings, mails } = setup({ leaderboard: { fault: "bad", "1+": "good" } });
	const failure = new Error("simulated parser failure");
	const originalParseInt = globalThis.parseInt;
	globalThis.parseInt = (text, radix) => {
		if (text === "fault") throw failure;
		return originalParseInt(text, radix);
	};
	try {
		await captureLogs(async (logs, errors) => {
			await manager.distributeRewards(settings, { leaderboard: [score("A", 100)] }, date);
			assert.deepEqual(errors, [['Failed to parse range "fault" for leaderboard "leaderboard" with spell "bad"', failure]]);
			assert.equal(mails.length, 1);
			assert.deepEqual(logs, [
				["Sent reward mail to A for leaderboard leaderboard with rank 1 and score 100"],
				["Sent a total of 1 mails for leaderboard leaderboard"],
			]);
		});
	} finally {
		globalThis.parseInt = originalParseInt;
	}
});

test("mail creates are sequential, continue after failure, and summaries count successes including zero-mail leaderboards", async () => {
	const { manager, settings } = setup({ leaderboard: { "1+": "reward" }, empty: { "1+": "reward" }, unmatched: { "2": "reward" }, absent: { "1+": "reward" } });
	const attempted: string[] = [];
	const failure = new Error("simulated create failure");
	let active = false;
	manager.db = {
		collection(name: string) {
			assert.equal(name, "lom2_mail");
			return {
				async create(mail: Mail) {
					assert.equal(active, false);
					active = true;
					attempted.push(mail.recipient_uuid);
					await Promise.resolve();
					active = false;
					if (mail.recipient_uuid === "A") throw failure;
					return { id: "success", ...mail };
				},
			};
		},
	} as unknown as PocketBase;
	await captureLogs(async (logs, errors) => {
		await manager.distributeRewards(
			settings,
			{ empty: [], leaderboard: [score("B", 90), score("A", 100)], unmatched: [score("C", 50)], unconfigured: [score("D", 20)] },
			date,
		);
		assert.deepEqual(attempted, ["A", "B"]);
		assert.deepEqual(logs, [
			["Sent a total of 0 mails for leaderboard empty"],
			["Sent reward mail to B for leaderboard leaderboard with rank 2 and score 90"],
			["Sent a total of 1 mails for leaderboard leaderboard"],
			["Sent a total of 0 mails for leaderboard unmatched"],
		]);
		const errorText = "Failed to send reward mail to A for leaderboard leaderboard with rank 1 and score 100";
		assert.deepEqual(errors, [[errorText, failure], [errorText]]);
	});
});

test("runRewards queries only valid parsed leaderboards and preserves invalid-range diagnostics", async () => {
	const { manager, settings } = setup({ broken: { nope: "bad" }, leaderboard: { "1": "gold" }, empty: {}, reversed: { "3-1": "never" } });
	const queries: unknown[] = [];
	manager.getLeaderboardDate = () => date;
	manager.postLeaderboardMessage = async (leaderboard, scores, postedDate) => {
		assert.equal(leaderboard, "leaderboard");
		assert.deepEqual(scores, [score("A", 100)]);
		assert.equal(postedDate, date);
	};
	manager.db = {
		collection(name: string) {
			if (name === "settings")
				return {
					async getFirstListItem(filter: string) {
						assert.equal(filter, 'key = "leaderboard_rewards"');
						return settings;
					},
				};
			if (name === "lom2_leaderboards")
				return {
					async getFullList(options: unknown) {
						queries.push(options);
						return [score("A", 100), score("R", 50, "reversed")];
					},
				};
			assert.equal(name, "lom2_mail");
			return {
				async create(mail: Mail) {
					return { id: "success", ...mail };
				},
			};
		},
	} as unknown as PocketBase;
	await captureLogs(async (logs, errors) => {
		await manager.runRewards();
		assert.deepEqual(queries, [{ filter: 'leaderboard="leaderboard" || leaderboard="reversed" && date ~ "2026-10-07" && value > 0' }]);
		assert.deepEqual(
			errors,
			Array.from({ length: 2 }, () => ['Parsed invalid range "nope" for leaderboard "broken" with spell "bad"']),
		);
		assert.deepEqual(logs, [
			["Sent reward mail to A for leaderboard leaderboard with rank 1 and score 100"],
			["Sent a total of 1 mails for leaderboard leaderboard"],
			["Sent a total of 0 mails for leaderboard reversed"],
		]);
	});
});

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
	{ name: "tied first place", values: [100, 100, 90], ranks: ["1st", "1st", "3rd"] },
	{ name: "three-way ties", values: [100, 90, 90, 90, 80], ranks: ["1st", "2nd", "2nd", "2nd", "5th"] },
	{ name: "multiple tied groups", values: [100, 100, 90, 90, 80], ranks: ["1st", "1st", "3rd", "3rd", "5th"] },
	{ name: "distinct scores", values: [100, 90, 80], ranks: ["1st", "2nd", "3rd"] },
	{ name: "nearby unequal scores", values: [100, 99.9, 99.8], ranks: ["1st", "2nd", "3rd"] },
]) {
	test(`reward ranks handle ${name}`, async () => {
		const { manager, settings, mails } = setup({ leaderboard: { "1+": "reward" } });
		const scores = values.map((value, i) => score(String(i), value));
		await manager.distributeRewards(settings, { leaderboard: scores }, date);
		assert.deepEqual(
			mails.map((mail) => mail.note.match(/<yellow>(.*?)<\/yellow>/)?.[1]),
			ranks,
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
