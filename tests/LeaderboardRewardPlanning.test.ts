import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLeaderboardContent, planLeaderboardRewards } from "../src/LeaderboardRewardPlanning.ts";

test("unexpected parser failures are structured diagnostics and do not discard later valid rules", () => {
	const failure = new Error("simulated parser failure");
	const originalParseInt = globalThis.parseInt;
	globalThis.parseInt = (text, radix) => {
		if (text === "fault") throw failure;
		return originalParseInt(text, radix);
	};
	try {
		const result = planLeaderboardRewards({}, { board: { fault: "bad", "1+": "good" } }, "Monday");
		assert.deepEqual(result, {
			eligibleLeaderboards: ["board"],
			mails: [],
			diagnostics: [{ kind: "parse-error", leaderboard: "board", range: "fault", spell: "bad", error: failure }],
		});
	} finally {
		globalThis.parseInt = originalParseInt;
	}
});

for (const { name, values, ranks } of [
	{ name: "second-place tie", values: [600, 800, 1000, 800], ranks: [1, 2, 2, 4] },
	{ name: "first-place tie", values: [100, 100, 90], ranks: [1, 1, 3] },
	{ name: "three-way tie", values: [100, 90, 90, 90, 80], ranks: [1, 2, 2, 2, 5] },
	{ name: "multiple ties", values: [100, 100, 90, 90, 80], ranks: [1, 1, 3, 3, 5] },
	{ name: "nearby unequal scores", values: [100, 99.9, 99.8], ranks: [1, 2, 3] },
]) {
	test(`pure planning preserves competition ranks for ${name}`, () => {
		const entries = values.map((value, i) => ({ account: String(i), value }));
		const result = planLeaderboardRewards({ leaderboard: entries }, { leaderboard: { "1+": "reward" } }, "Tuesday");
		assert.deepEqual(
			result.mails.map((mail) => mail.metadata.rank),
			ranks,
		);
		assert.deepEqual(
			result.mails.map((mail) => mail.metadata.account),
			[...entries].sort((a, b) => b.value - a.value).map((entry) => entry.account),
		);
	});
}

test("ties crossing the last rewarded position both receive rewards", () => {
	const result = planLeaderboardRewards(
		{
			board: [
				{ account: "A", value: 100 },
				{ account: "B", value: 90 },
				{ account: "C", value: 90 },
				{ account: "D", value: 80 },
			],
		},
		{ board: { "1-2": "reward" } },
		"Monday",
	);
	assert.deepEqual(
		result.mails.map((mail) => mail.metadata.account),
		["A", "B", "C"],
	);
});

test("independent leaderboard ranks, overlapping rules and fetched leaderboard iteration order are preserved", () => {
	const result = planLeaderboardRewards(
		{
			other: [{ account: "C", value: 50 }],
			board: [
				{ account: "B", value: 100 },
				{ account: "A", value: 100 },
			],
		},
		{ board: { "1+": "participation", "1": "gold", "1-2": "bonus" }, other: { "1": "otherGold" } },
		"Sunday",
	);
	assert.deepEqual(
		result.mails.map((mail) => [mail.metadata.leaderboard, mail.metadata.account, mail.metadata.rank, mail.payload.rewards.map((reward) => reward.command)]),
		[
			["other", "C", 1, ["ms cast as {player} otherGold"]],
			["board", "B", 1, ["ms cast as {player} gold", "ms cast as {player} participation", "ms cast as {player} bonus"]],
			["board", "A", 1, ["ms cast as {player} gold", "ms cast as {player} participation", "ms cast as {player} bonus"]],
		],
	);
});

test("ordinal suffixes are literal independent expectations in mail notes", () => {
	const entries = Array.from({ length: 123 }, (_, i) => ({ account: String(i + 1), value: 900 - i }));
	const result = planLeaderboardRewards({ board: entries }, { board: { "1+": "reward" } }, "Thursday");
	for (const [rank, ordinal] of [
		[1, "1st"],
		[2, "2nd"],
		[3, "3rd"],
		[4, "4th"],
		[10, "10th"],
		[11, "11th"],
		[12, "12th"],
		[13, "13th"],
		[21, "21st"],
		[22, "22nd"],
		[23, "23rd"],
		[101, "101st"],
		[102, "102nd"],
		[103, "103rd"],
		[111, "111th"],
		[112, "112th"],
		[113, "113th"],
		[121, "121st"],
		[122, "122nd"],
		[123, "123rd"],
	] as const) {
		assert.equal(
			result.mails[rank - 1].payload.note,
			`<gold>Congratulations!</gold>\nYou placed <yellow>${ordinal}</yellow> on Thursday's leaderboard\nwith your score of <white>${entries[rank - 1].value}</white>.`,
		);
	}
});

test("planning and display do not mutate frozen inputs or share mutable payloads with another plan", () => {
	const entries = Object.freeze([Object.freeze({ account: "B", name: "B", value: 90 }), Object.freeze({ account: "A", name: "A", value: 100 })]);
	const scores = Object.freeze({ board: entries });
	const config = Object.freeze({ board: Object.freeze({ "1+": "reward" }) });
	const snapshot = structuredClone({ scores, config });
	const first = planLeaderboardRewards(scores, config, "Monday");
	formatLeaderboardContent(entries);
	first.mails[0].payload.rewards[0].command = "changed";
	assert.deepEqual({ scores, config }, snapshot);
	assert.equal(planLeaderboardRewards(scores, config, "Monday").mails[0].payload.rewards[0].command, "ms cast as {player} reward");
});

test("empty, unconfigured and unmatched leaderboards produce no mail", () => {
	const result = planLeaderboardRewards(
		{ empty: [], unconfigured: [{ account: "A", value: 100 }], unmatched: [{ account: "B", value: 90 }] },
		{ empty: { "1+": "reward" }, unmatched: { "2": "reward" }, absent: { "1": "reward" } },
		"Saturday",
	);
	assert.deepEqual(result, { eligibleLeaderboards: ["empty", "unmatched", "absent"], mails: [], diagnostics: [] });
	assert.deepEqual(planLeaderboardRewards({}, {}, "Saturday"), { eligibleLeaderboards: [], mails: [], diagnostics: [] });
});

test("range parsing retains parseInt permissiveness, hyphen priority and Object.entries order without stricter validation", () => {
	const result = planLeaderboardRewards(
		{
			board: [
				{ account: "A", value: 30 },
				{ account: "B", value: 20 },
				{ account: "C", value: 10 },
			],
		},
		{
			board: {
				"2junk": "prefix",
				" 1 - 2more - ignored ": "range",
				"0+": "zero",
				"0x2": "hex",
				"1.9": "decimal",
				"3-1": "reversed",
				"1-2+": "hyphen",
				"2more+": "open",
				"0": "zeroOnly",
				"-1": "negative",
				"1-": "missingEnd",
				"+": "missingStart",
			},
		},
		"Monday",
	);
	assert.deepEqual(
		result.mails.map((mail) => mail.payload.rewards.map((reward) => reward.command)),
		[
			["range", "zero", "decimal", "hyphen"],
			["prefix", "range", "zero", "hex", "hyphen", "open"],
			["zero", "open"],
		].map((spells) => spells.map((spell) => `ms cast as {player} ${spell}`)),
	);
	assert.deepEqual(
		result.diagnostics.map(({ range }) => range),
		["-1", "1-", "+"],
	);
	assert.deepEqual(planLeaderboardRewards({}, { reversed: { "3-1": "never" }, zero: { "0": "never" } }, "Monday").eligibleLeaderboards, ["reversed", "zero"]);
});

test("pure display reuses competition ranks, stable ties, winner highlighting and 16-entry limit", () => {
	const scores = Array.from({ length: 17 }, (_, i) => ({ name: String(i), value: i < 2 ? 1000 : 1000 - i }));
	assert.deepEqual(formatLeaderboardContent(scores).split("\n").slice(0, 3), ["1\\. **0: 1,000**", "1\\. **1: 1,000**", "3\\. 2: **998**"]);
	assert.equal(formatLeaderboardContent(scores).split("\n").length, 16);
	assert.equal(formatLeaderboardContent([]), "");
});

test("returns ordered invalid-range diagnostics and only eligible parsed leaderboards without logging", () => {
	const errors: unknown[][] = [];
	const originalError = console.error;
	console.error = (...args) => {
		errors.push(args);
	};
	try {
		const result = planLeaderboardRewards({}, { broken: { nope: "bad", "1-nope": "badEnd" }, mixed: { "?+": "badStart", "2": "valid" }, empty: {} }, "Monday");
		assert.deepEqual(result, {
			eligibleLeaderboards: ["mixed"],
			mails: [],
			diagnostics: [
				{ kind: "invalid-range", leaderboard: "broken", range: "nope", spell: "bad" },
				{ kind: "invalid-range", leaderboard: "broken", range: "1-nope", spell: "badEnd" },
				{ kind: "invalid-range", leaderboard: "mixed", range: "?+", spell: "badStart" },
			],
		});
		assert.deepEqual(errors, []);
	} finally {
		console.error = originalError;
	}
});

test("plans exact domain-only mail payloads with explicit weekday and metadata", () => {
	const result = planLeaderboardRewards({ leaderboard: [{ account: "A", value: 1234.5 }] }, { leaderboard: { "1": "gold", "1+": "participation" } }, "Friday");
	assert.deepEqual(result, {
		eligibleLeaderboards: ["leaderboard"],
		diagnostics: [],
		mails: [
			{
				metadata: { leaderboard: "leaderboard", account: "A", rank: 1, score: 1234.5 },
				payload: {
					sender_name: "<gold>Grand Paladin Order</gold>",
					sender_uuid: "",
					recipient_name: "",
					recipient_uuid: "A",
					available: true,
					note: "<gold>Congratulations!</gold>\nYou placed <yellow>1st</yellow> on Friday's leaderboard\nwith your score of <white>1,234.5</white>.",
					rewards: [
						{ type: "command", command: "ms cast as {player} gold" },
						{ type: "command", command: "ms cast as {player} participation" },
					],
				},
			},
		],
	});
});
