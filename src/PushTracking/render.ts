import { escapeMarkdown } from "discord.js";
import type { Push, Stage, StageStatus } from "./store.js";

const LIMIT = 2000;
const EMOJI: Record<StageStatus, string> = {
	queued: "⏳",
	running: "🔄",
	success: "✅",
	failure: "❌",
	skipped: "⏭️",
	cancelled: "⏹️",
};

/** First line of a commit message, safe to show in Discord (no mentions, links or markdown). */
export function subject(message: string): string {
	return escapeMarkdown(message.split(/\r?\n/)[0].slice(0, 180).replace(/@/g, "@​").replace(/</g, "‹").replace(/>/g, "›"));
}

/** Free text (names, errors) embedded in a message line. */
export function plain(text: string, max = 300): string {
	return subject(text.replace(/\s+/g, " ").trim().slice(0, max));
}

function overall(push: Push, stages: Stage[]): string {
	if (push.superseded) return "⚠️";
	if (stages.some((stage) => stage.status === "failure")) return EMOJI.failure;
	if (stages.some((stage) => stage.status === "running" || stage.status === "queued")) return EMOJI.running;
	return stages.length ? EMOJI.success : "📥";
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

export function renderPush(push: Push, stages: Stage[], deployedVia?: { link: string | null }): string {
	const root = `https://github.com/${push.repo}`;
	const short = push.sha.slice(0, 7);
	const parts = [`**[${escapeMarkdown(push.repo)}](<${root}>)**`, `[\`${short}\`](<${root}/commit/${push.sha}>)`];
	if (push.pusher) parts.push(`pushed by ${plain(push.pusher, 60)}`);
	if (push.compareUrl) parts.push(`[compare](<${push.compareUrl}>)`);
	const header = `${overall(push, stages)} ${parts.join(" · ")}`;

	const footer = stages.map(stageLine);
	if (deployedVia) footer.push(`↪️ Deployed together with a later push${deployedVia.link ? `: ${deployedVia.link}` : "."}`);
	if (push.superseded) footer.push("⚠️ A later force push replaced this history; these commits may no longer be on the branch.");
	const tail = footer.join("\n").slice(0, 900);

	const commits = push.commits;
	const lines: string[] = [];
	if (!commits) lines.push("_Waiting for push details from GitHub._");
	else {
		// Keep room for the header, stage lines and the "more commits" note.
		let budget = LIMIT - header.length - tail.length - 120;
		for (const commit of commits) {
			const line = `- [\`${commit.sha.slice(0, 7)}\`](<${root}/commit/${commit.sha}>) ${subject(commit.subject)}`;
			if (line.length + 1 > budget) break;
			lines.push(line);
			budget -= line.length + 1;
		}
		const hidden = commits.length - lines.length;
		if (hidden > 0) lines.push(`…and ${hidden} more commit(s)${push.compareUrl ? ` in the [comparison](<${push.compareUrl}>)` : ""}.`);
		if (!commits.length) lines.push("_No new commits._");
	}
	return [header, ...lines, tail].filter(Boolean).join("\n").slice(0, LIMIT);
}
