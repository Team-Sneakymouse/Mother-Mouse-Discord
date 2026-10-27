import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { Client } from "discord.js";
import GithubPrStatus, {
	collectOpenPullRequests,
	createDigestRunner,
	createGithubApi,
	formatDigest,
	handleMergeButton,
	markMerged,
} from "../src/GithubPrStatus.ts";

test("real HTTP authentication, rate-limit, server and timeout failures are logged without posting or leaking credentials", async () => {
	let status = 401;
	let hang = false;
	const server = createServer((request, response) => {
		assert.equal(request.headers.authorization, "Bearer test-only-not-a-real-token");
		if (hang) return;
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ message: "private diagnostic" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const api = createGithubApi("test-only-not-a-real-token");
	api.defaults.baseURL = `http://127.0.0.1:${address.port}`;
	api.defaults.proxy = false;
	api.defaults.timeout = 100;
	const errors: string[] = [];
	const sent: unknown[] = [];
	const run = createDigestRunner({
		collect: () => collectOpenPullRequests(api),
		send: async (message) => {
			sent.push(message);
		},
		logError: (message) => errors.push(message),
	});
	try {
		for (status of [401, 403, 429, 500]) await run();
		hang = true;
		await run();
		assert.equal(errors.length, 5);
		assert.deepEqual(sent, []);
		assert.ok(errors.every((message) => message.includes("collection failed") && !message.includes("test-only") && !message.includes("private diagnostic")));
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
});

test("missing configuration logs once without registering a schedule", () => {
	const client = new Client({ intents: [] });
	const errors: unknown[][] = [];
	const originalError = console.error;
	console.error = (...args) => {
		errors.push(args);
	};
	try {
		assert.equal(GithubPrStatus(client, ""), undefined);
		assert.equal(client.listenerCount("clientReady"), 0);
		assert.equal(errors.length, 1);
	} finally {
		console.error = originalError;
	}
});

test("empty organization needs only one request and returns an empty snapshot", async () => {
	let calls = 0;
	assert.deepEqual(
		await collectOpenPullRequests({
			get: async () => {
				calls++;
				return { data: [] };
			},
		}),
		[],
	);
	assert.equal(calls, 1);
});

test("accepts organization case variants without changing repository identifiers", async () => {
	for (const full_name of ["team-sneakymouse/MixedCase.Repo", "tEaM-SnEaKyMoUsE/MixedCase.Repo"]) {
		const calls: string[] = [];
		const result = await collectOpenPullRequests({
			get: async (path) => {
				calls.push(path);
				return { data: path.startsWith("/orgs/") ? [{ full_name }] : [pr(1)] };
			},
		});
		assert.deepEqual(result, [{ repository: full_name, ...pr(1) }]);
		assert.deepEqual(calls, ["/orgs/Team-Sneakymouse/repos", `/repos/${full_name}/pulls`]);
	}
});

test("rejects repositories from a foreign organization regardless of case", async () => {
	for (const full_name of ["OtherOrg/repo", "otherorg/repo"]) {
		await assert.rejects(collectOpenPullRequests({ get: async () => ({ data: [{ full_name }] }) }));
	}
});

test("rejects oversized repository names before producing invalid Discord chunks", async () => {
	await assert.rejects(collectOpenPullRequests({ get: async (path) => ({ data: path.startsWith("/orgs/") ? [repo("x".repeat(2000))] : [pr(1)] }) }));
});

test("GitHub client uses authenticated fixed-origin requests, bounded timeout and no redirects", () => {
	const api = createGithubApi("test-only-not-a-real-token");
	assert.equal(api.defaults.baseURL, "https://api.github.com");
	assert.equal(api.defaults.headers.Authorization, "Bearer test-only-not-a-real-token");
	assert.equal(api.defaults.timeout, 15000);
	assert.equal(api.defaults.maxRedirects, 0);
	assert.equal(api.defaults.headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("production wiring schedules noon UTC after Discord ready, targets the exact channel and stays DST-independent", async () => {
	const client = new Client({ intents: [] });
	const sent: unknown[] = [];
	client.channels.fetch = async (id) => {
		assert.equal(id, "808030927937994772");
		return {
			isSendable: () => true,
			send: async (message: unknown) => {
				sent.push(message);
			},
		} as never;
	};
	const api = { get: async (path: string) => ({ data: path.startsWith("/orgs/") ? [repo("test")] : [pr(1)] }) };
	const job = GithubPrStatus(client, "test-only-not-a-real-token", api);
	assert.ok(job);
	try {
		assert.equal(job.running, false);
		assert.equal(job.cronTime.timeZone, "Etc/UTC");
		for (const date of ["2026-03-28T12:01:00Z", "2026-10-24T12:01:00Z"]) {
			const next = job.cronTime.getNextDateFrom(new Date(date), "Etc/UTC");
			assert.equal(next.hour, 12);
			assert.equal(next.minute, 0);
			assert.equal(next.second, 0);
			assert.equal(next.day, new Date(date).getUTCDate() + 1);
		}
		client.emit("clientReady", client as never);
		assert.equal(job.running, true);
		await job.fireOnTick();
		assert.equal(sent.length, 1);
	} finally {
		job.stop();
	}
	const bot = readFileSync(new URL("../src/bot.ts", import.meta.url), "utf8");
	assert.match(bot, /if \(process.env.PRODUCTION === "TRUE"\) \{[\s\S]*GithubPrStatus\(client\);/);
});

test("runner is silent for no PRs and reports unchanged PRs on successive days without mentions or embeds", async () => {
	const sent: unknown[] = [];
	const errors: string[] = [];
	let entries = [] as Awaited<ReturnType<typeof collectOpenPullRequests>>;
	const run = createDigestRunner({
		collect: async () => entries,
		send: async (message) => {
			sent.push(message);
		},
		logError: (message) => errors.push(message),
	});
	await run();
	assert.deepEqual(sent, []);
	entries = [{ repository: "Team-Sneakymouse/test", ...pr(1) }];
	await run();
	await run();
	assert.equal(sent.length, 2);
	assert.deepEqual(sent[0], sent[1]);
	assert.deepEqual(sent[0], formatDigest(entries)[0]);
	assert.deepEqual(JSON.parse(JSON.stringify(sent[0])).allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
	assert.equal((sent[0] as { flags: number }).flags, 1 << 15);
	assert.deepEqual(errors, []);
});

test("runner logs failed collection separately, sends no partial digest and releases its overlap guard", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const sent: unknown[] = [];
	const errors: string[] = [];
	const run = createDigestRunner({
		collect: async () => {
			calls++;
			await gate;
			throw new Error("secret token must not be logged");
		},
		send: async (message) => {
			sent.push(message);
		},
		logError: (message) => errors.push(message),
	});
	const first = run();
	await run();
	assert.equal(calls, 1);
	release();
	await first;
	await run();
	assert.equal(calls, 2);
	assert.deepEqual(sent, []);
	assert.equal(errors.length, 2);
	assert.ok(errors.every((message) => message.includes("collection failed") && !message.includes("secret")));
});

test("collection propagates later-page and malformed response errors rather than returning partial results", async () => {
	for (const data of [null, { message: "rate limited" }, [{ full_name: "OtherOrg/repo" }], [repo("x".repeat(2000))]]) {
		await assert.rejects(collectOpenPullRequests({ get: async () => ({ data }) }));
	}
	await assert.rejects(
		collectOpenPullRequests({
			get: async (path, options) => {
				if (path.startsWith("/orgs/")) return { data: [repo("test")] };
				if (options.params.page === 1) return { data: Array.from({ length: 100 }, (_, i) => pr(i + 1)) };
				throw new Error("page 2 failed");
			},
		}),
		/page 2 failed/,
	);
});

test("send failures stop remaining parts, log delivery stage, and allow the next run", async () => {
	const entries = Array.from({ length: 100 }, (_, i) => ({ repository: "Team-Sneakymouse/test", ...pr(i + 1) }));
	let sends = 0;
	const errors: string[] = [];
	const run = createDigestRunner({
		collect: async () => entries,
		send: async () => {
			sends++;
			throw new Error("Discord denied");
		},
		logError: (message) => errors.push(message),
	});
	await run();
	await run();
	assert.equal(sends, 2);
	assert.equal(errors.length, 2);
	assert.ok(errors.every((message) => message.includes("delivery failed (0/") && !message.includes("denied")));
});

// Flatten a built message into its text contents and buttons.
function inspect(message: unknown) {
	const json = JSON.parse(JSON.stringify(message)) as { components: unknown[] };
	const texts: string[] = [];
	const buttons: { custom_id?: string; url?: string; label: string; disabled?: boolean; style: number }[] = [];
	let count = 0;
	const walk = (node: unknown) => {
		if (Array.isArray(node)) return node.forEach(walk);
		if (!node || typeof node !== "object") return;
		count++;
		const record = node as Record<string, unknown>;
		if (record.type === 10) texts.push(record.content as string);
		if (record.type === 2) buttons.push(record as never);
		walk(record.components);
		walk(record.accessory);
	};
	walk(json.components);
	return { texts, buttons, count };
}

test("formats deterministic repository groups, safe titles/authors, draft labels, complete links and a merge button per PR", () => {
	const entries = [
		{ repository: "Team-Sneakymouse/z", ...pr(8), draft: false },
		{ repository: "Team-Sneakymouse/a", ...pr(2), title: "@everyone **hi**\n<@123>", user: null },
		{ repository: "Team-Sneakymouse/a", ...pr(1), title: "😀".repeat(2000) },
	];
	const messages = formatDigest(entries);
	assert.deepEqual(JSON.parse(JSON.stringify(messages)), JSON.parse(JSON.stringify(formatDigest([...entries].reverse()))));
	assert.deepEqual(formatDigest([]), []);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].content, undefined);
	const { texts, buttons } = inspect(messages[0]);
	const text = texts.join("\n");
	assert.ok(text.indexOf("Team-Sneakymouse/a") < text.indexOf("Team-Sneakymouse/z"));
	assert.ok(text.indexOf("/a/pull/1") < text.indexOf("/a/pull/2"));
	assert.ok(text.includes("[DRAFT]"));
	assert.ok(text.includes("unknown author"));
	assert.ok(!text.includes("@everyone"));
	assert.ok(!text.includes("<@123>"));
	assert.ok(!text.includes("**hi**"));
	for (const entry of entries) assert.ok(text.includes(`https://github.com/${entry.repository}/pull/${entry.number}`));
	assert.deepEqual(
		buttons.map((button) => [button.custom_id, button.url, button.label, button.style, button.disabled ?? false]),
		[
			[undefined, "https://github.com/Team-Sneakymouse/a/pull/1", "Open draft", 5, false],
			[undefined, "https://github.com/Team-Sneakymouse/a/pull/2", "Open draft", 5, false],
			["ghpr-merge:z:8", undefined, "Merge", 3, false],
		],
	);
});

test("splits into messages within Discord's Components V2 limits without splitting a PR", () => {
	const many = formatDigest(Array.from({ length: 100 }, (_, i) => ({ repository: "Team-Sneakymouse/a", ...pr(i + 1) })));
	assert.ok(many.length > 1);
	let buttons = 0;
	many.forEach((message, i) => {
		const view = inspect(message);
		assert.ok(view.count <= 40);
		assert.ok(view.texts.join("").length <= 4000);
		assert.ok(view.texts[0].includes(`Part ${i + 1}/${many.length}`));
		assert.ok(view.texts[1].includes("Team-Sneakymouse/a"));
		buttons += view.buttons.length;
	});
	assert.equal(buttons, 100);
	const long = formatDigest(Array.from({ length: 12 }, (_, i) => ({ repository: "Team-Sneakymouse/a", ...pr(i + 1), title: "x".repeat(1000) })));
	assert.ok(long.every((message) => inspect(message).texts.join("").length <= 4000));
});

test("repository names that overflow the custom id are truncated, keeping the merge button", () => {
	const name = "r".repeat(100);
	const { buttons } = inspect(formatDigest([{ repository: `Team-Sneakymouse/${name}`, ...pr(12345), draft: false }])[0]);
	const id = buttons[0].custom_id as string;
	assert.equal(id.length, 100);
	assert.ok(id.endsWith("~:12345"));
	assert.ok(`Team-Sneakymouse/${name}`.toLowerCase().startsWith(`team-sneakymouse/${id.slice("ghpr-merge:".length, -"~:12345".length)}`));
	assert.equal(buttons[0].label, "Merge");
	assert.equal(buttons[0].url, undefined);
});

function clickHarness(options: { admin?: boolean; roles?: unknown; customId?: string; repos?: string[]; put?: () => Promise<{ data: unknown }> } = {}) {
	const message = formatDigest([
		{ repository: "Team-Sneakymouse/a", ...pr(1), draft: false },
		{ repository: "Team-Sneakymouse/a", ...pr(2), draft: false },
	])[0];
	const wire = JSON.parse(JSON.stringify(message)).components as unknown[];
	const calls: string[] = [];
	const puts: string[] = [];
	const gets: string[] = [];
	const interaction = {
		customId: options.customId ?? "ghpr-merge:a:2",
		memberPermissions: { has: () => options.admin ?? true },
		member: { roles: options.roles ?? [] },
		user: { username: "dani" },
		message: { components: wire.map((component) => ({ toJSON: () => component })) },
		reply: async (payload: unknown) => calls.push(`reply:${JSON.stringify(payload)}`),
		deferUpdate: async () => calls.push("deferUpdate"),
		followUp: async (payload: { content: string }) => calls.push(`followUp:${payload.content}`),
		editReply: async (payload: unknown) => calls.push(`editReply:${JSON.stringify(payload)}`),
	};
	const api = {
		get: async (path: string) => {
			gets.push(path);
			return { data: (options.repos ?? []).map((full_name) => ({ full_name })) };
		},
		put: async (path: string) => {
			puts.push(path);
			return options.put ? options.put() : { data: { merged: true } };
		},
	};
	return { interaction, api, calls, puts, gets, wire };
}

test("merge button merges using only the custom id and greys out just that button in place", async () => {
	const { interaction, api, calls, puts, wire } = clickHarness();
	await handleMergeButton(interaction as never, api);
	assert.deepEqual(puts, ["/repos/Team-Sneakymouse/a/pulls/2/merge"]);
	assert.equal(calls[0], "deferUpdate");
	assert.equal(calls.length, 2);
	const edited = JSON.parse(calls[1].slice("editReply:".length)).components;
	const before = inspect({ components: wire });
	const after = inspect({ components: edited });
	assert.deepEqual(after.buttons[0], before.buttons[0]);
	assert.equal(after.buttons[1].disabled, true);
	assert.equal(after.buttons[1].style, 2);
	assert.equal(after.buttons[1].label, "Merged by dani");
	assert.deepEqual(after.texts, before.texts);
});

test("merge button refuses members who are neither Tech Team nor administrators without calling GitHub", async () => {
	for (const roles of [[], ["1"], { cache: new Map() }]) {
		const { interaction, api, calls, puts } = clickHarness({ admin: false, roles });
		await handleMergeButton(interaction as never, api);
		assert.deepEqual(puts, []);
		assert.equal(calls.length, 1);
		assert.ok(calls[0].startsWith("reply:") && calls[0].includes("Tech Team"));
	}
});

test("the Tech Team role may merge, whether roles arrive as ids or as a cached manager", async () => {
	for (const roles of [["1", "816744626751799366"], { cache: new Map([["816744626751799366", {}]]) }]) {
		const { interaction, api, puts } = clickHarness({ admin: false, roles });
		await handleMergeButton(interaction as never, api);
		assert.deepEqual(puts, ["/repos/Team-Sneakymouse/a/pulls/2/merge"]);
	}
});

test("a truncated id is resolved to the single matching repository before merging", async () => {
	const full = `Team-Sneakymouse/${"r".repeat(100)}`;
	const { interaction, api, puts, gets } = clickHarness({ customId: `ghpr-merge:${"r".repeat(80)}~:7`, repos: ["Team-Sneakymouse/other", full] });
	await handleMergeButton(interaction as never, api);
	assert.deepEqual(gets, ["/orgs/Team-Sneakymouse/repos"]);
	assert.deepEqual(puts, [`/repos/${full}/pulls/7/merge`]);
});

test("an ambiguous or unknown truncated id merges nothing and says why", async () => {
	for (const repos of [[], ["Team-Sneakymouse/rrrr-1", "Team-Sneakymouse/rrrr-2"]]) {
		const { interaction, api, calls, puts } = clickHarness({ customId: "ghpr-merge:rrrr~:7", repos });
		const originalError = console.error;
		console.error = () => {};
		try {
			await handleMergeButton(interaction as never, api);
		} finally {
			console.error = originalError;
		}
		assert.deepEqual(puts, []);
		assert.ok(calls.at(-1)?.startsWith("followUp:") && calls.at(-1)?.includes(`matches ${repos.length} repositories`));
		assert.ok(calls.every((call) => !call.startsWith("editReply:")));
	}
});

test("failed merges leave the message untouched and report privately without leaking credentials", async () => {
	const server = createServer((_request, response) => {
		response.writeHead(405, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ message: "Pull Request is not mergeable" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const real = createGithubApi("test-only-not-a-real-token");
	real.defaults.baseURL = `http://127.0.0.1:${address.port}`;
	real.defaults.proxy = false;
	const { interaction, calls } = clickHarness();
	const originalError = console.error;
	const logged: string[] = [];
	console.error = (...args) => {
		logged.push(args.join(" "));
	};
	try {
		await handleMergeButton(interaction as never, { get: (path, options) => real.get(path, options), put: (path) => real.put(path) });
	} finally {
		console.error = originalError;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeAllConnections();
		});
	}
	assert.equal(calls.length, 2);
	assert.equal(calls[0], "deferUpdate");
	assert.ok(calls[1].startsWith("followUp:") && calls[1].includes("Pull Request is not mergeable") && calls[1].includes("405"));
	assert.ok([...calls, ...logged].every((entry) => !entry.includes("test-only")));
});

test("a 200 response that did not merge is treated as a failure", async () => {
	const { interaction, api, calls } = clickHarness({ put: async () => ({ data: { merged: false } }) });
	const originalError = console.error;
	console.error = () => {};
	try {
		await handleMergeButton(interaction as never, api);
	} finally {
		console.error = originalError;
	}
	assert.ok(calls.every((call) => !call.startsWith("editReply:")));
});

test("markMerged only touches the matching button", () => {
	const tree = {
		components: [
			{ type: 9, accessory: { type: 2, custom_id: "a", label: "Merge", style: 3 } },
			{ type: 9, accessory: { type: 2, custom_id: "b", label: "Merge", style: 3 } },
		],
	};
	const result = markMerged(tree, "a", "x") as typeof tree;
	assert.equal((result.components[0].accessory as { disabled?: boolean }).disabled, true);
	assert.deepEqual(result.components[1], tree.components[1]);
});

const repo = (name: string) => ({ full_name: `Team-Sneakymouse/${name}`, private: true });
const pr = (number: number) => ({ number, title: `Change ${number}`, user: { login: "author" }, draft: true });

test("collects every repository and open PR page, including private repositories and drafts", async () => {
	const calls: { path: string; params: Record<string, unknown> }[] = [];
	const api = {
		async get(path: string, options: { params: Record<string, unknown> }) {
			calls.push({ path, params: options.params });
			const page = options.params.page;
			if (path === "/orgs/Team-Sneakymouse/repos") return { data: page === 1 ? Array.from({ length: 100 }, (_, i) => repo(`repo${i}`)) : [repo("last")] };
			if (path.endsWith("/last/pulls")) return { data: page === 1 ? Array.from({ length: 100 }, (_, i) => pr(i + 1)) : [pr(101)] };
			return { data: [] };
		},
	};
	const result = await collectOpenPullRequests(api);
	assert.equal(result.length, 101);
	assert.deepEqual(result[100], { repository: "Team-Sneakymouse/last", ...pr(101) });
	assert.equal(calls.filter((call) => call.path.endsWith("/pulls")).length, 102);
	assert.ok(calls.every((call) => call.params.per_page === 100));
	assert.ok(calls.filter((call) => call.path.endsWith("/pulls")).every((call) => call.params.state === "open"));
	assert.equal(calls[0].params.type, "all");
});
