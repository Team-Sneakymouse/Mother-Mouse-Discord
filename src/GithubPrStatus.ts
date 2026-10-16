import axios from "axios";
import { CronJob } from "cron";
import { type Client, escapeMarkdown, type MessageCreateOptions, MessageFlags } from "discord.js";
import { z } from "zod";

export function createGithubApi(token: string) {
	return axios.create({
		baseURL: "https://api.github.com",
		timeout: 15000,
		maxRedirects: 0,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
}

export default function GithubPrStatus(client: Client, token = process.env.GITHUB_TOKEN, api?: GithubApi): CronJob | undefined {
	if (!token?.trim()) {
		console.error("GithubPrStatus: GITHUB_TOKEN missing; daily digest disabled.");
		return;
	}
	const github = api ?? createGithubApi(token);
	const run = createDigestRunner({
		collect: () => collectOpenPullRequests(github),
		send: async (message) => {
			const channel = await client.channels.fetch("808030927937994772");
			if (!channel?.isSendable()) throw new Error("Digest channel is not sendable");
			return channel.send(message);
		},
		logError: (message) => console.error(message),
	});
	const job = CronJob.from({ cronTime: "0 0 12 * * *", onTick: run, start: false, timeZone: "Etc/UTC", waitForCompletion: true });
	client.once("clientReady", () => job.start());
	return job;
}

function safeText(value: string, limit: number): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip controls and bidi overrides from untrusted GitHub text.
	const characters = Array.from(value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " "));
	return (
		escapeMarkdown(characters.slice(0, limit).join("").replace(/@/g, "@\u200b").replace(/</g, "‹").replace(/>/g, "›")) + (characters.length > limit ? "…" : "")
	);
}

export function formatDigest(pulls: readonly OpenPullRequest[]): string[] {
	const sorted = [...pulls].sort((a, b) => (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : a.number - b.number));
	const chunks: string[] = [];
	let chunk = "";
	let repository = "";
	for (const pull of sorted) {
		const heading = `**${safeText(pull.repository, 160)}**\n`;
		const line = `- ${pull.draft ? "[DRAFT] " : ""}#${pull.number} ${safeText(pull.title, 300)} — ${safeText(pull.user?.login ?? "unknown author", 80)}\n  <https://github.com/${pull.repository}/pull/${pull.number}>\n`;
		let addition = (repository === pull.repository ? "" : `\n${heading}`) + line;
		// Reserve room for the multipart header and never split a PR/link across messages.
		if (chunk.length + addition.length > 1900) {
			chunks.push(chunk);
			chunk = "";
			addition = heading + line;
		}
		chunk += addition;
		repository = pull.repository;
	}
	if (chunk) chunks.push(chunk);
	return chunks.map((content, index) => `**Daily open PRs — Part ${index + 1}/${chunks.length}**\n${content}`);
}

export function createDigestRunner(options: {
	collect: () => Promise<OpenPullRequest[]>;
	send: (message: MessageCreateOptions) => Promise<unknown>;
	logError: (message: string) => void;
}): () => Promise<void> {
	let running = false;
	return async () => {
		if (running) return;
		running = true;
		let stage = "collection";
		let sent = 0;
		let total = 0;
		try {
			// Collect and validate the entire snapshot before any Discord side effects.
			const messages = formatDigest(await options.collect());
			total = messages.length;
			stage = "delivery";
			for (const content of messages) {
				await options.send({ content, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }, flags: MessageFlags.SuppressEmbeds });
				sent++;
			}
		} catch {
			// Axios errors contain request headers (including the token); never log raw errors.
			options.logError(`GithubPrStatus: ${stage} failed (${sent}/${total} parts delivered); digest incomplete.`);
		} finally {
			running = false;
		}
	};
}

const repositorySchema = z.object({
	full_name: z
		.string()
		.max(160)
		.regex(/^Team-Sneakymouse\/[A-Za-z0-9_.-]+$/i),
});
const pullRequestSchema = z.object({
	number: z.number().int().positive(),
	title: z.string(),
	user: z.object({ login: z.string() }).nullable(),
	draft: z.boolean(),
});
export type OpenPullRequest = z.infer<typeof pullRequestSchema> & { repository: string };
type GithubApi = { get(path: string, options: { params: Record<string, string | number> }): Promise<{ data: unknown }> };

async function pages<T>(api: GithubApi, path: string, params: Record<string, string | number>, schema: z.ZodType<T>): Promise<T[]> {
	const result: T[] = [];
	for (let page = 1; ; page++) {
		const response = await api.get(path, { params: { ...params, per_page: 100, page } });
		const items = z.array(schema).parse(response.data);
		result.push(...items);
		if (items.length < 100) return result;
	}
}

export async function collectOpenPullRequests(api: GithubApi): Promise<OpenPullRequest[]> {
	const repositories = await pages(api, "/orgs/Team-Sneakymouse/repos", { type: "all", sort: "full_name", direction: "asc" }, repositorySchema);
	const result: OpenPullRequest[] = [];
	for (const repository of repositories) {
		const pulls = await pages(api, `/repos/${repository.full_name}/pulls`, { state: "open", sort: "created", direction: "asc" }, pullRequestSchema);
		result.push(...pulls.map((pull) => ({ repository: repository.full_name, ...pull })));
	}
	return result;
}
