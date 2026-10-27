import assert from "node:assert/strict";
import { test } from "node:test";
import { hooksApi, hooksConfig } from "../src/JobHooks.ts";

test("HTTP client uses exact claim/ack contract, secret, limit=1 and no redirects", async () => {
	const original = globalThis.fetch;
	const calls: { url: string; init: RequestInit }[] = [];
	try {
		globalThis.fetch = (async (url, init) => {
			calls.push({ url: String(url), init: init! });
			return Response.json(String(url).endsWith("/claim") ? { items: [], hasMore: false } : { ok: true });
		}) as typeof fetch;
		const config = hooksConfig({ JOBBOARD_HOOKS_URL: "https://hooks.example", JOBBOARD_INTERNAL_SECRET: "test-secret", JOBBOARD_STATE_DIR: "/state" });
		const api = hooksApi(config, new AbortController().signal);
		await api.claim();
		await api.ack({ eventId: "1", leaseToken: "token", kind: "create", job: {} as any }, "123");
		assert.equal(calls[0].url, "https://hooks.example/internal/lom/jobs/discord/claim");
		assert.deepEqual(JSON.parse(calls[0].init.body as string), { limit: 1 });
		assert.equal((calls[0].init.headers as Record<string, string>)["X-Internal-Secret"], "test-secret");
		assert.equal(calls[0].init.redirect, "error");
		assert.ok(calls[0].init.signal);
		assert.equal(calls[1].url, "https://hooks.example/internal/lom/jobs/discord/ack");
		assert.deepEqual(JSON.parse(calls[1].init.body as string), { eventId: "1", leaseToken: "token", discordMessageId: "123" });
	} finally {
		globalThis.fetch = original;
	}
});
test("HTTP client surfaces stale lease/config/server errors and malformed responses", async () => {
	const original = globalThis.fetch;
	const config = hooksConfig({ JOBBOARD_HOOKS_URL: "https://hooks.example", JOBBOARD_INTERNAL_SECRET: "test-secret", JOBBOARD_STATE_DIR: "/state" });
	const api = hooksApi(config, new AbortController().signal);
	try {
		for (const status of [401, 409, 503]) {
			globalThis.fetch = async () => new Response("", { status });
			await assert.rejects(api.claim(), new RegExp(String(status)));
		}
		globalThis.fetch = async () => Response.json({ bad: true });
		await assert.rejects(api.claim());
		const aborted = new AbortController();
		aborted.abort();
		globalThis.fetch = async (_url, init) => {
			init!.signal!.throwIfAborted();
			return Response.json({});
		};
		await assert.rejects(hooksApi(config, aborted.signal).claim());
	} finally {
		globalThis.fetch = original;
	}
});
