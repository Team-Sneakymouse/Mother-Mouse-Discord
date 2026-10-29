import { escapeMarkdown } from "discord.js";
import type { Push, Stage, StageStatus } from "./store.js";

/** Components V2 messages allow 4000 characters of text in total. */
const LIMIT = 4000;
const EMOJI: Record<StageStatus, string> = {
	queued: "⏳",
	running: "🔄",
	success: "✅",
	failure: "❌",
	skipped: "⏭️",
	cancelled: "⏹️",
};
export const COLOR = {
	pushed: 0x5865f2,
	queued: 0xf1c40f,
	running: 0x3498db,
	success: 0x2ecc71,
	failure: 0xe74c3c,
	skipped: 0x95a5a6,
	cancelled: 0x95a5a6,
	superseded: 0x95a5a6,
} as const;

/** A message rendered into one colored container. Sections are separated by a divider. */
export type PushMessage = { color: number; sections: string[] };

/** First line of a commit message, safe to show in Discord (no mentions, links or markdown). */
export function subject(message: string): string {
	return escapeMarkdown(message.split(/\r?\n/)[0].slice(0, 180).replace(/@/g, "@​").replace(/</g, "‹").replace(/>/g, "›"));
}

/** Free text (names, errors) embedded in a message line. */
export function plain(text: string, max = 300): string {
	return subject(text.replace(/\s+/g, " ").trim().slice(0, max));
}

const string = (value: unknown) => (typeof value === "string" ? value : undefined);

function stageLine(stage: Stage): string {
	const emoji = EMOJI[stage.status] ?? "❔";
	const url = string(stage.detail.url);
	if (stage.kind === "workflow") {
		const name = plain(string(stage.detail.name) ?? "Workflow", 100);
		const attempt = Number(stage.detail.attempt) > 1 ? ` (attempt ${Number(stage.detail.attempt)})` : "";
		return `${emoji} CI · ${url ? `[${name}](<${url}>)` : name} — ${stage.status}${attempt}`;
	}
	if (stage.kind === "artifact") {
		// The Reposilite worker supplies trusted, already formatted progress text.
		return `${emoji} ${string(stage.detail.text) ?? `**${plain(stage.key, 100)}** ${stage.status}`}`;
	}
	const error = string(stage.detail.error);
	const state = stage.status === "success" ? "container updated" : stage.status === "failure" ? "container update failed" : stage.status;
	return `${emoji} 🐳 \`${plain(stage.key, 100)}\` — ${state}${error ? `: ${plain(error, 300)}` : ""}`;
}

/** `stages` must be ordered by last update; only the latest one is shown. */
export function renderPush(push: Push, stages: Stage[], deployedVia?: { link: string | null }): PushMessage {
	const root = `https://github.com/${push.repo}`;
	const latest = stages.at(-1);
	const color = push.superseded ? COLOR.superseded : deployedVia ? COLOR.success : latest ? COLOR[latest.status] : COLOR.pushed;

	const name = push.repo.split("/").at(-1)!;
	const parts = [`**[${escapeMarkdown(name)}](<${root}>)**`];
	if (push.pusher) parts.push(plain(push.pusher, 60));
	if (push.compareUrl) parts.push(`[compare](<${push.compareUrl}>)`);
	else parts.push(`[\`${push.sha.slice(0, 7)}\`](<${root}/commit/${push.sha}>)`);
	const header = parts.join(" · ");

	const status = latest ? [stageLine(latest)] : [];
	if (deployedVia) status.push(`↪️ Deployed together with a later push${deployedVia.link ? `: ${deployedVia.link}` : "."}`);
	if (push.superseded) status.push("⚠️ A later force push replaced this history; these commits may no longer be on the branch.");
	const footer = status.join("\n").slice(0, 1000);

	const commits = push.commits;
	const lines: string[] = [];
	if (!commits) lines.push("_Waiting for push details from GitHub._");
	else if (!commits.length) lines.push("_No new commits._");
	else {
		// Keep the newest commits; GitHub lists them oldest first. Leave room for the header, status and note.
		let budget = LIMIT - header.length - footer.length - 150;
		for (let i = commits.length - 1; i >= 0; i--) {
			const commit = commits[i];
			const line = `- [\`${commit.sha.slice(0, 7)}\`](<${root}/commit/${commit.sha}>) ${subject(commit.subject)}`;
			if (line.length + 1 > budget) break;
			lines.unshift(line);
			budget -= line.length + 1;
		}
		const hidden = commits.length - lines.length;
		if (hidden > 0) lines.unshift(`…${hidden} earlier commit(s)${push.compareUrl ? ` in the [comparison](<${push.compareUrl}>)` : ""}.`);
	}
	const sections = [[header, ...lines].join("\n")];
	if (footer) sections.push(footer);
	return { color, sections };
}
