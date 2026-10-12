export type RewardScore = { account: string; value: number };
export type RewardConfig = Readonly<Record<string, Readonly<Record<string, string>>>>;
export type MailCreatePayload = {
	sender_name: string;
	sender_uuid: string;
	recipient_name: string;
	recipient_uuid: string;
	available: true;
	note: string;
	rewards: { type: "command"; command: string }[];
};
export type PlannedRewardMail = {
	metadata: { leaderboard: string; account: string; rank: number; score: number };
	payload: MailCreatePayload;
};
export type RewardParsingDiagnostic = { leaderboard: string; range: string; spell: string } & (
	| { kind: "invalid-range" }
	| { kind: "parse-error"; error: unknown }
);
export type RewardPlan = { eligibleLeaderboards: string[]; mails: PlannedRewardMail[]; diagnostics: RewardParsingDiagnostic[] };

export function formatLeaderboardContent(scores: readonly { name: string; value: number }[]): string {
	return rankScores(scores)
		.slice(0, 16)
		.map(({ score, rank }) =>
			rank === 1
				? `${rank}\\. **${score.name}: ${Intl.NumberFormat("en-US").format(score.value)}**`
				: `${rank}\\. ${score.name}: **${Intl.NumberFormat("en-US").format(score.value)}**`,
		)
		.join("\n");
}

type RewardRule = { start: number; end: number; spell: string };

function parseRules(config: RewardConfig, diagnostics: RewardParsingDiagnostic[]): Map<string, RewardRule[]> {
	const rules = new Map<string, RewardRule[]>();
	for (const [leaderboard, ranges] of Object.entries(config)) {
		for (const [range, spell] of Object.entries(ranges || {})) {
			let start: number, end: number;
			try {
				if (range.includes("-")) {
					[start, end] = range.split("-").map((s) => parseInt(s.trim()));
				} else if (range.endsWith("+")) {
					start = parseInt(range.slice(0, -1).trim());
					end = Number.MAX_SAFE_INTEGER;
				} else {
					start = end = parseInt(range.trim());
				}
			} catch (error) {
				diagnostics.push({ kind: "parse-error", leaderboard, range, spell, error });
				continue;
			}
			if (Number.isNaN(start) || Number.isNaN(end)) {
				diagnostics.push({ kind: "invalid-range", leaderboard, range, spell });
				continue;
			}
			if (!rules.has(leaderboard)) rules.set(leaderboard, []);
			rules.get(leaderboard)!.push({ start, end, spell });
		}
	}
	return rules;
}

/** Competition ranks: equal scores share the best position (1, 2, 2, 4). */
function rankScores<T extends { value: number }>(scores: readonly T[]): { score: T; rank: number }[] {
	const sorted = [...scores].sort((a, b) => b.value - a.value);
	let rank = 1;
	return sorted.map((score, i) => {
		if (i > 0 && score.value !== sorted[i - 1].value) rank = i + 1;
		return { score, rank };
	});
}

function getRewardCommands(rules: readonly RewardRule[], rank: number): string[] {
	return rules.filter((rule) => rank >= rule.start && rank <= rule.end).map((rule) => `ms cast as {player} ${rule.spell}`);
}

function getOrdinal(i: number): string {
	const suffixes = ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"];
	const absI = Math.abs(i);
	const mod100 = absI % 100;
	const mod10 = absI % 10;
	if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
	return `${i}${suffixes[mod10]}`;
}

export function planLeaderboardRewards(scores: Readonly<Record<string, readonly RewardScore[]>>, config: RewardConfig, weekday: string): RewardPlan {
	const diagnostics: RewardParsingDiagnostic[] = [];
	const rules = parseRules(config, diagnostics);
	const mails: PlannedRewardMail[] = [];
	for (const [leaderboard, entries] of Object.entries(scores)) {
		const leaderboardRules = rules.get(leaderboard);
		if (!leaderboardRules) continue;
		for (const { score, rank } of rankScores(entries)) {
			const commands = getRewardCommands(leaderboardRules, rank);
			if (commands.length === 0) continue;
			mails.push({
				metadata: { leaderboard, account: score.account, rank, score: score.value },
				payload: {
					sender_name: "<gold>Grand Paladin Order</gold>",
					sender_uuid: "",
					recipient_name: "",
					recipient_uuid: score.account,
					available: true,
					note: `<gold>Congratulations!</gold>\nYou placed <yellow>${getOrdinal(rank)}</yellow> on ${weekday}'s leaderboard\nwith your score of <white>${Intl.NumberFormat("en-US").format(score.value)}</white>.`,
					rewards: commands.map((command) => ({ type: "command", command })),
				},
			});
		}
	}
	return { eligibleLeaderboards: [...rules.keys()], mails, diagnostics };
}
