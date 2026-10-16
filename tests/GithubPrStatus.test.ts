import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";
import { Client } from "discord.js";
import GithubPrStatus, { collectOpenPullRequests, createDigestRunner, createGithubApi, formatDigest } from "../src/GithubPrStatus.ts";

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
	assert.deepEqual(sent[0], { content: formatDigest(entries)[0], allowedMentions: { parse: [], users: [], roles: [], repliedUser: false }, flags: 4 });
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

test("formats deterministic repository groups, safe titles/authors, draft labels and complete links within Discord limits", () => {
	const entries = [
		{ repository: "Team-Sneakymouse/z", ...pr(8), draft: false },
		{ repository: "Team-Sneakymouse/a", ...pr(2), title: "@everyone **hi**\n<@123>", user: null },
		{ repository: "Team-Sneakymouse/a", ...pr(1), title: "😀".repeat(2000) },
	];
	const messages = formatDigest(entries);
	assert.deepEqual(messages, formatDigest([...entries].reverse()));
	assert.deepEqual(formatDigest([]), []);
	assert.ok(messages.every((message) => message.length <= 2000));
	const text = messages.join("\n");
	assert.ok(text.indexOf("Team-Sneakymouse/a") < text.indexOf("Team-Sneakymouse/z"));
	assert.ok(text.indexOf("/a/pull/1") < text.indexOf("/a/pull/2"));
	assert.ok(text.includes("[DRAFT]"));
	assert.ok(text.includes("unknown author"));
	assert.ok(!text.includes("@everyone"));
	assert.ok(!text.includes("<@123>"));
	assert.ok(!text.includes("**hi**"));
	for (const entry of entries) assert.ok(text.includes(`https://github.com/${entry.repository}/pull/${entry.number}`));
	const many = formatDigest(Array.from({ length: 100 }, (_, i) => ({ repository: "Team-Sneakymouse/a", ...pr(i + 1) })));
	assert.ok(many.length > 1);
	assert.ok(many.every((message, i) => message.length <= 2000 && message.includes(`Part ${i + 1}/${many.length}`) && message.includes("Team-Sneakymouse/a")));
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
