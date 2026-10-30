import axios from "axios";
import { CronJob } from "cron";
import {
	type APIButtonComponent,
	type APIMessageTopLevelComponent,
	ApplicationCommandType,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	type Client,
	ContextMenuCommandBuilder,
	escapeMarkdown,
	type MessageContextMenuCommandInteraction,
	type MessageCreateOptions,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	TextDisplayBuilder,
} from "discord.js";
import { z } from "zod";

const REFRESH_COMMAND = "Refresh PR status";
export const data = [new ContextMenuCommandBuilder().setType(ApplicationCommandType.Message).setName(REFRESH_COMMAND)];

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
	const readApi = { get: github.get.bind(github) };
	client.on("interactionCreate", (interaction) => {
		if (!interaction.isMessageContextMenuCommand() || interaction.commandName !== REFRESH_COMMAND) return;
		handleRefreshCommand(interaction, readApi).catch(() => console.error("GithubPrStatus: refresh interaction failed."));
	});
	if (github.put) {
		const mergeApi = { get: github.get.bind(github), put: github.put.bind(github) };
		client.on("interactionCreate", (interaction) => {
			if (!interaction.isButton() || !parseMergeId(interaction.customId)) return;
			handleMergeButton(interaction, mergeApi).catch(() => console.error("GithubPrStatus: merge interaction failed."));
		});
	}
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

// Components V2 limits: 40 components per message (nested ones included) and 4000 characters of text.
const MAX_COMPONENTS = 40;
const MAX_TEXT = 3900;
const HEADER_TEXT = 60;
const PULL_COMPONENTS = 3; // section + text display + button
const ORGANIZATION = "Team-Sneakymouse";
const MERGE_PREFIX = "ghpr-merge:";
const MERGE_ID = /^ghpr-merge:([A-Za-z0-9_.-]+)(~?):([0-9]+)$/;
const TECH_TEAM_ROLE = "816744626751799366";

// All state lives in the custom id, so buttons keep working across restarts. The organization is
// implied and a name that still does not fit in the 100-character limit is cut and marked with "~".
function parseMergeId(customId: string): { name: string; truncated: boolean; number: number } | undefined {
	const match = MERGE_ID.exec(customId);
	return match ? { name: match[1], truncated: match[2] === "~", number: Number(match[3]) } : undefined;
}

type PullRef = { repository: string; number: number };

function mergeId(pull: PullRef): string {
	const suffix = `:${pull.number}`;
	const budget = 100 - MERGE_PREFIX.length - suffix.length;
	const name = pull.repository.slice(pull.repository.indexOf("/") + 1);
	return MERGE_PREFIX + (name.length > budget ? `${name.slice(0, budget - 1)}~` : name) + suffix;
}

function pullButton(pull: PullRef & { draft: boolean }): ButtonBuilder {
	if (pull.draft) {
		return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open draft").setURL(`https://github.com/${pull.repository}/pull/${pull.number}`);
	}
	return new ButtonBuilder().setCustomId(mergeId(pull)).setStyle(ButtonStyle.Success).setLabel("Merge");
}

const DRAFT_PREFIX = "[DRAFT] ";
const DIGEST_HEADER = "**Daily open PRs";

export function formatDigest(pulls: readonly OpenPullRequest[]): MessageCreateOptions[] {
	const sorted = [...pulls].sort((a, b) => (a.repository < b.repository ? -1 : a.repository > b.repository ? 1 : a.number - b.number));
	const groups: { pull: OpenPullRequest; text: string; heading?: string }[][] = [];
	let components = 0;
	let length = 0;
	let repository = "";
	for (const pull of sorted) {
		const text = `${pull.draft ? DRAFT_PREFIX : ""}[#${pull.number}](https://github.com/${pull.repository}/pull/${pull.number}) ${safeText(pull.title, 300)} — ${safeText(pull.user?.login ?? "unknown author", 80)}`;
		const heading = `**${safeText(pull.repository, 160)}**`;
		let withHeading = repository !== pull.repository;
		const cost = (withHeading ? 1 : 0) + PULL_COMPONENTS;
		const textCost = (withHeading ? heading.length : 0) + text.length;
		// Never split a PR across messages; repeat the repository heading at the start of the next one.
		if (!groups.length || components + cost > MAX_COMPONENTS - 1 || length + textCost > MAX_TEXT - HEADER_TEXT) {
			groups.push([]);
			components = 0;
			length = 0;
			withHeading = true;
		}
		components += (withHeading ? 1 : 0) + PULL_COMPONENTS;
		length += (withHeading ? heading.length : 0) + text.length;
		repository = pull.repository;
		groups[groups.length - 1].push({ pull, text, heading: withHeading ? heading : undefined });
	}
	return groups.map((group, index) => {
		const components: (TextDisplayBuilder | SectionBuilder)[] = [
			new TextDisplayBuilder().setContent(`${DIGEST_HEADER} — Part ${index + 1}/${groups.length}**`),
		];
		for (const { pull, text, heading } of group) {
			if (heading) components.push(new TextDisplayBuilder().setContent(heading));
			components.push(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text)).setButtonAccessory(pullButton(pull)));
		}
		return { components, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
	});
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
			for (const message of messages) {
				await options.send(message);
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
type GithubGet = (path: string, options: { params: Record<string, string | number> }) => Promise<{ data: unknown }>;
type MergeApi = { get: GithubGet; put(path: string): Promise<{ data: unknown }> };
type GithubApi = { get: GithubGet; put?: MergeApi["put"] };

async function pages<T>(api: { get: GithubGet }, path: string, params: Record<string, string | number>, schema: z.ZodType<T>): Promise<T[]> {
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

const mergeResponseSchema = z.object({ merged: z.boolean() });

export async function mergePullRequest(api: MergeApi, repository: string, number: number): Promise<void> {
	const response = await api.put(`/repos/${repository}/pulls/${number}/merge`);
	if (!mergeResponseSchema.parse(response.data).merged) throw new Error("GitHub did not merge the pull request");
}

class MergeTargetError extends Error {}

/** Expand the repository named by a button id, looking up the full name when the id had to truncate it. */
async function resolveRepository(api: MergeApi, target: { name: string; truncated: boolean }): Promise<string> {
	if (!target.truncated) return `${ORGANIZATION}/${target.name}`;
	const prefix = `${ORGANIZATION}/${target.name}`.toLowerCase();
	const matches = (await pages(api, `/orgs/${ORGANIZATION}/repos`, { type: "all" }, repositorySchema)).filter((repository) =>
		repository.full_name.toLowerCase().startsWith(prefix),
	);
	if (matches.length !== 1) throw new MergeTargetError(`the shortened repository name matches ${matches.length} repositories, so nothing was merged.`);
	return matches[0].full_name;
}

function canMerge(interaction: ButtonInteraction): boolean {
	if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
	const roles = interaction.member?.roles;
	return Array.isArray(roles) ? roles.includes(TECH_TEAM_ROLE) : !!roles?.cache.has(TECH_TEAM_ROLE);
}

function mergeFailureReason(error: unknown): string {
	if (error instanceof MergeTargetError) return error.message;
	// Never include raw errors: axios errors carry request headers, including the token.
	if (!axios.isAxiosError(error) || !error.response) return "the GitHub request failed.";
	const { status, data } = error.response;
	if (status === 401 || status === 403 || status === 404) return `GitHub refused the request (HTTP ${status}); the token may lack access to it.`;
	const message = z.object({ message: z.string() }).safeParse(data);
	return message.success ? `${safeText(message.data.message, 200)} (HTTP ${status})` : `GitHub returned HTTP ${status}.`;
}

function doneLabel(verb: string, user: string | undefined): string {
	return user ? `${verb} by ${Array.from(user).slice(0, 60).join("")}` : verb;
}

/** Grey out the clicked Merge button in place, leaving the rest of the message untouched. */
export function markMerged(node: unknown, customId: string, mergedBy: string): unknown {
	if (Array.isArray(node)) return node.map((child) => markMerged(child, customId, mergedBy));
	if (node === null || typeof node !== "object") return node;
	const record = node as Record<string, unknown>;
	if (record.custom_id === customId) {
		return { ...record, style: ButtonStyle.Secondary, label: doneLabel("Merged", mergedBy), disabled: true };
	}
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, markMerged(value, customId, mergedBy)]));
}

export async function handleMergeButton(interaction: ButtonInteraction, api: MergeApi): Promise<void> {
	const target = parseMergeId(interaction.customId);
	if (!target) return;
	const allowedMentions = { parse: [] as [] };
	if (!canMerge(interaction)) {
		await interaction.reply({
			content: "You need the Tech Team role (or Administrator) to merge pull requests.",
			flags: MessageFlags.Ephemeral,
			allowedMentions,
		});
		return;
	}
	await interaction.deferUpdate();
	const label = `${ORGANIZATION}/${target.name}${target.truncated ? "…" : ""}#${target.number}`;
	try {
		await mergePullRequest(api, await resolveRepository(api, target), target.number);
	} catch (error) {
		console.error(`GithubPrStatus: merge of ${label} failed.`);
		await interaction.followUp({
			content: `Could not merge ${safeText(label, 200)}: ${mergeFailureReason(error)}`,
			flags: MessageFlags.Ephemeral,
			allowedMentions,
		});
		return;
	}
	const components = interaction.message.components.map((component) => component.toJSON());
	await interaction.editReply({ components: markMerged(components, interaction.customId, interaction.user.username) as APIMessageTopLevelComponent[] });
}

const livePullSchema = z.object({
	state: z.enum(["open", "closed"]),
	merged: z.boolean(),
	draft: z.boolean(),
	merged_by: z.object({ login: z.string() }).nullable(),
});
const closedIssueSchema = z.object({ closed_by: z.object({ login: z.string() }).nullable() });
// The PR link at the start of each digest row; it always holds the full repository name, even for drafts.
const PULL_LINK = /\(https:\/\/github\.com\/(Team-Sneakymouse\/[A-Za-z0-9_.-]+)\/pull\/([0-9]+)\)/i;

type PullState = "open" | "draft" | "merged" | "closed";
type Section = { type: number; components: { content: string }[]; accessory: Record<string, unknown> };
type RowUpdate = { state: PullState; button: APIButtonComponent };

/** The PR a top-level digest section links to, if it is a PR row. */
function rowPull(component: unknown): PullRef | undefined {
	const section = component as Partial<Section>;
	if (section.type !== 9 || section.accessory?.type !== 2 || typeof section.components?.[0]?.content !== "string") return;
	const match = PULL_LINK.exec(section.components[0].content);
	return match ? { repository: match[1], number: Number(match[2]) } : undefined;
}

const pullKey = (pull: PullRef) => `${pull.repository.toLowerCase()}#${pull.number}`;
// Merging is final, so a row that already names who merged it is kept as is.
const isMergedButton = (button: Record<string, unknown>) => button.disabled === true && typeof button.label === "string" && button.label.startsWith("Merged");

async function liveButton(api: { get: GithubGet }, pull: PullRef): Promise<RowUpdate> {
	const live = livePullSchema.parse((await api.get(`/repos/${pull.repository}/pulls/${pull.number}`, { params: {} })).data);
	const done = new ButtonBuilder().setCustomId(mergeId(pull)).setDisabled(true);
	if (live.merged) {
		return { state: "merged", button: done.setStyle(ButtonStyle.Secondary).setLabel(doneLabel("Merged", live.merged_by?.login)).toJSON() };
	}
	if (live.state === "closed") {
		// GitHub only reports who closed a PR on its issue.
		const issue = closedIssueSchema.parse((await api.get(`/repos/${pull.repository}/issues/${pull.number}`, { params: {} })).data);
		return { state: "closed", button: done.setStyle(ButtonStyle.Danger).setLabel(doneLabel("Closed", issue.closed_by?.login)).toJSON() };
	}
	return { state: live.draft ? "draft" : "open", button: pullButton({ ...pull, draft: live.draft }).toJSON() };
}

/** Look up the live state of every PR in one digest message that is not already marked merged. */
export async function fetchRowUpdates(api: { get: GithubGet }, components: readonly unknown[]): Promise<Map<string, RowUpdate>> {
	const updates = new Map<string, RowUpdate>();
	for (const component of components) {
		const pull = rowPull(component);
		if (pull && !isMergedButton((component as Section).accessory)) updates.set(pullKey(pull), await liveButton(api, pull));
	}
	return updates;
}

/** Swap in the looked-up buttons and draft labels. Rows that became merged meanwhile are left alone. */
export function applyRowUpdates(components: readonly unknown[], updates: ReadonlyMap<string, RowUpdate>): unknown[] {
	return components.map((component) => {
		const pull = rowPull(component);
		const update = pull && updates.get(pullKey(pull));
		const section = component as Section;
		if (!update || isMergedButton(section.accessory)) return component;
		const [text, ...rest] = section.components;
		const content = text.content.startsWith(DRAFT_PREFIX) ? text.content.slice(DRAFT_PREFIX.length) : text.content;
		return {
			...section,
			components: [{ ...text, content: (update.state === "draft" ? DRAFT_PREFIX : "") + content }, ...rest],
			accessory: update.button,
		};
	});
}

function isDigest(components: readonly unknown[]): boolean {
	const first = components[0] as { type?: number; content?: unknown } | undefined;
	return first?.type === 10 && typeof first.content === "string" && first.content.startsWith(DIGEST_HEADER);
}

/** Refresh only the right-clicked digest message; other parts of the same digest are not touched. */
export async function handleRefreshCommand(interaction: MessageContextMenuCommandInteraction, api: { get: GithubGet }): Promise<void> {
	const allowedMentions = { parse: [] as [] };
	const target = interaction.targetMessage;
	const components = target.components.map((component) => component.toJSON());
	if (target.author.id !== interaction.client.user.id || !isDigest(components)) {
		await interaction.reply({ content: "That is not a PR digest message.", flags: MessageFlags.Ephemeral, allowedMentions });
		return;
	}
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	let updates: Map<string, RowUpdate>;
	try {
		updates = await fetchRowUpdates(api, components);
	} catch (error) {
		// Never include raw errors: axios errors carry request headers, including the token.
		console.error("GithubPrStatus: refresh lookup failed.");
		const reason = error instanceof z.ZodError ? "GitHub returned an unexpected response." : mergeFailureReason(error);
		await interaction.editReply({ content: `Could not refresh, nothing was changed: ${reason}`, allowedMentions });
		return;
	}
	// Re-read the message so a Merge click during the lookups is not overwritten.
	const latest = (await target.fetch()).components.map((component) => component.toJSON());
	await target.edit({ components: applyRowUpdates(latest, updates) as APIMessageTopLevelComponent[], allowedMentions });
	const counts = { open: 0, draft: 0, merged: 0, closed: 0 };
	for (const { state } of updates.values()) counts[state]++;
	const summary = Object.entries(counts)
		.filter(([, count]) => count)
		.map(([state, count]) => `${count} ${state}`)
		.join(", ");
	await interaction.editReply({ content: updates.size ? `Refreshed ${updates.size} PRs: ${summary}.` : "Nothing to refresh.", allowedMentions });
}
