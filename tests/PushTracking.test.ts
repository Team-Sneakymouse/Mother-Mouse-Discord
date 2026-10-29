import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { COLOR, renderPush } from "../src/PushTracking/render.ts";
import { registerPushTrackingRoutes, validSignature } from "../src/PushTracking/routes.ts";
import { MemoryPushStore, type Push } from "../src/PushTracking/store.ts";
import { githubRepo, type MessageSink, PushTracker } from "../src/PushTracking/tracker.ts";

const REPO = "Team-Sneakymouse/SneakyMail";
const sha = (n: number) => n.toString(16).padStart(4, "0") + "b".repeat(36);

function fakeSink() {
	// Messages are stored as their sections joined by newlines; colors separately.
	const messages = new Map<string, string>();
	const colors = new Map<string, number>();
	const sent: string[] = [];
	let count = 0;
	const sink: MessageSink & { failEdit?: unknown } = {
		async send(message) {
			const id = `m${++count}`;
			const content = message.sections.join("\n");
			messages.set(id, content);
			colors.set(id, message.color);
			sent.push(content);
			return id;
		},
		async edit(id, message) {
			if (sink.failEdit) throw sink.failEdit;
			if (!messages.has(id)) throw { code: 10008 };
			messages.set(id, message.sections.join("\n"));
			colors.set(id, message.color);
		},
		link: (id) => `https://discord.test/${id}`,
	};
	return { sink, messages, colors, sent };
}

function setup() {
	const store = new MemoryPushStore();
	const discord = fakeSink();
	let time = 1_000_000;
	const tracker = new PushTracker(store, discord.sink, () => time);
	return { store, discord, tracker, advance: (ms: number) => (time += ms) };
}

function pushEvent(after: string, before: string, overrides: Record<string, unknown> = {}) {
	return {
		ref: "refs/heads/main",
		before,
		after,
		forced: false,
		compare: `https://github.com/${REPO}/compare/${before.slice(0, 12)}...${after.slice(0, 12)}`,
		pusher: { name: "DaniDipp" },
		commits: [{ id: after, message: `Change ${after.slice(0, 4)}\n\nBody`, author: { username: "DaniDipp" } }],
		repository: { full_name: REPO, default_branch: "main" },
		...overrides,
	};
}

function runEvent(head: string, status: string, conclusion: string | null = null, overrides: Record<string, unknown> = {}) {
	return {
		action: status === "completed" ? "completed" : status === "in_progress" ? "in_progress" : "requested",
		workflow_run: {
			id: 77,
			workflow_id: 5,
			name: "Build and publish",
			head_sha: head,
			head_branch: "main",
			event: "push",
			status,
			conclusion,
			html_url: "https://github.com/Team-Sneakymouse/SneakyMail/actions/runs/77",
			run_attempt: 1,
			...overrides,
		},
		repository: { full_name: REPO, default_branch: "main" },
	};
}

test("each push to the default branch gets one message; other refs and deletions are ignored", async () => {
	const { tracker, discord } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.push(pushEvent(sha(2), sha(1), { ref: "refs/heads/feature" }));
	await tracker.push(pushEvent("0".repeat(40), sha(1), { deleted: true }));
	await tracker.push(pushEvent(sha(3), sha(1), { ref: "refs/tags/v1" }));
	await tracker.flush();
	assert.equal(discord.sent.length, 1);
	const header = discord.sent[0].split("\n")[0];
	assert.match(header, /^\*\*\[SneakyMail\]\(<https:\/\/github\.com\/Team-Sneakymouse\/SneakyMail>\)\*\* · DaniDipp · \[compare\]\(<[^>]+>\)$/);
	assert.doesNotMatch(header, /\/commit\/|pushed by/, "The header shows only the repository name, pusher and compare link");
	assert.equal(discord.colors.get("m1"), COLOR.pushed);
	assert.match(discord.sent[0], /Change 0001$/m);
	assert.doesNotMatch(discord.sent[0], /Body/);
	await tracker.flush();
	assert.equal(discord.sent.length, 1, "Unchanged pushes are not rendered again");
});

test("workflow runs may arrive before the push and update the same message through to completion", async () => {
	const { tracker, discord } = setup();
	await tracker.workflowRun(runEvent(sha(1), "queued"));
	await tracker.flush();
	assert.equal(discord.sent.length, 1);
	assert.match(discord.sent[0], /Waiting for push details/);
	assert.match(discord.sent[0], /⏳ CI · \[Build and publish\].* — queued/);
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.workflowRun(runEvent(sha(1), "in_progress"));
	await tracker.flush();
	assert.equal(discord.sent.length, 1);
	assert.match(discord.messages.get("m1")!, /\n- .*Change 0001\n🔄 CI .* — running$/s);
	assert.equal(discord.colors.get("m1"), COLOR.running);
	await tracker.workflowRun(runEvent(sha(1), "completed", "failure"));
	await tracker.workflowRun(runEvent(sha(1), "completed", "success", { run_attempt: 2 }));
	await tracker.flush();
	assert.match(discord.messages.get("m1")!, /\n✅ CI .* — success \(attempt 2\)$/s);
	assert.equal(discord.messages.get("m1")!.match(/CI ·/g)?.length, 1, "Only the latest status is shown");
	assert.equal(discord.colors.get("m1"), COLOR.success);
	assert.equal(discord.sent.length, 1);

	await tracker.workflowRun(runEvent(sha(9), "queued", null, { event: "pull_request" }));
	await tracker.workflowRun(runEvent(sha(9), "queued", null, { head_branch: "feature" }));
	await tracker.flush();
	assert.equal(discord.sent.length, 1, "Only runs for pushes to the default branch are tracked");
});

test("deployments match release commit prefixes and include earlier pushes that never deployed", async () => {
	const { tracker, discord, store } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.push(pushEvent(sha(2), sha(1)));
	await tracker.push(pushEvent(sha(3), sha(2)));
	await tracker.push(pushEvent(sha(4), sha(3)));
	await tracker.flush();
	// Push 1 deployed itself; pushes 2 and 3 failed to build; push 4 deploys all of them.
	// Release versions carry a short hash, and POM repository URLs may differ in case.
	assert.equal(
		await tracker.artifact(
			{ repository: REPO.toLowerCase(), commit: sha(1).slice(0, 7) },
			{ id: "SneakyMail", status: "success", text: "Uploaded **SneakyMail** `1`" },
		),
		true,
	);
	assert.equal(
		await tracker.artifact({ repository: REPO, commit: sha(4) }, { id: "SneakyMail", status: "running", text: "Deploying **SneakyMail** `4`" }),
		true,
	);
	assert.equal(
		await tracker.artifact({ repository: REPO, commit: sha(4) }, { id: "SneakyMail", status: "success", text: "Uploaded **SneakyMail** `4`" }),
		true,
	);
	assert.equal(await tracker.artifact({ repository: "Team-Sneakymouse/Other", commit: sha(4) }, { id: "Other", status: "success", text: "" }), false);
	await tracker.flush();
	const [p4, p3, p2, p1] = await store.recent(REPO, 10);
	assert.equal(p3.deployedVia, p4.id);
	assert.equal(p2.deployedVia, p4.id);
	assert.equal(p1.deployedVia, null, "A push that deployed itself is not claimed by a later one");
	const latest = discord.messages.get(p4.messageId!)!;
	assert.match(latest, /✅ Uploaded \*\*SneakyMail\*\* `4`/);
	assert.doesNotMatch(latest, /Deploying/, "The stage line is replaced, not appended");
	assert.match(discord.messages.get(p2.messageId!)!, new RegExp(`↪️ Deployed together with a later push: https://discord.test/${p4.messageId}`));
});

test("a force push marks earlier undeployed pushes as superseded", async () => {
	const { tracker, store, discord } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.push(pushEvent(sha(2), sha(1)));
	const [deployedPush] = await store.recent(REPO, 10);
	await store.setStage(deployedPush.id, { kind: "container", key: "app", status: "success", detail: {} });
	await tracker.push(pushEvent(sha(3), sha(2)));
	await tracker.push(pushEvent(sha(5), sha(3), { forced: true }));
	await tracker.flush();
	const [forced, p3, p2] = await store.recent(REPO, 10);
	assert.equal(forced.superseded, false);
	assert.equal(p3.superseded, true);
	assert.equal(p2.superseded, false, "Deployed pushes stay as they are");
	assert.match(discord.messages.get(p3.messageId!)!, /⚠️ A later force push replaced this history/);
	assert.equal(discord.colors.get(p3.messageId!), COLOR.superseded);
});

test("Watchtower updates are matched by image source and revision, others get their own message", async () => {
	const { tracker, store, discord } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.flush();
	await tracker.watchtower({ title: "Watchtower updates", report: null, entries: [{ message: "Watchtower started" }] });
	await tracker.watchtower({
		report: {
			updated: [
				{
					name: "/sneakymail",
					imageName: "registry/sneakymail:latest",
					state: "Updated",
					latestImageRevision: sha(1),
					ociSource: `https://github.com/${REPO}.git`,
				},
				{ name: "wikijs", imageName: "registry/wikijs:latest", state: "Updated" },
				{ name: "other", imageName: "registry/other:latest", latestImageRevision: sha(7), ociSource: "https://github.com/Team-Sneakymouse/Unknown" },
			],
			failed: [
				{
					name: "broken",
					imageName: "registry/broken:latest",
					error: "pull failed @everyone",
					latestImageRevision: sha(1),
					ociSource: `https://github.com/${REPO}`,
				},
			],
		},
	});
	await tracker.flush();
	const [push] = await store.recent(REPO, 1);
	const message = discord.messages.get(push.messageId!)!;
	assert.equal(discord.colors.get(push.messageId!), COLOR.failure);
	assert.match(message, /\n❌ 🐳 `broken` — container update failed: pull failed @​everyone$/);
	assert.doesNotMatch(message, /`sneakymail` — container updated/, "Only the latest stage is shown");
	assert.equal((await store.stages(push.id)).length, 2, "Earlier stages are still recorded");
	assert.deepEqual(discord.sent.slice(1).sort(), [
		"🐳 Updated container `other` (`registry/other:latest`).",
		"🐳 Updated container `wikijs` (`registry/wikijs:latest`).",
	]);
	await assert.rejects(tracker.watchtower({ report: { updated: [{ imageName: "missing name" }] } }));
});

test("container reports use short or full SHAs and repeated reports are idempotent", async () => {
	const { tracker, store } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	assert.equal(await tracker.container(REPO, sha(1), "mother-mouse-discord", "success"), true);
	assert.equal(await tracker.container(REPO, sha(1).slice(0, 7), "mother-mouse-discord", "success"), true);
	assert.equal(await tracker.container(REPO, "not-a-sha", "x", "success"), false);
	const [push] = await store.recent(REPO, 1);
	assert.equal((await store.stages(push.id)).length, 1);
});

test("deleted messages are recreated and transient Discord errors retry with backoff, never duplicating", async () => {
	const { tracker, discord, store, advance } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.flush();
	const [push] = await store.recent(REPO, 1);
	discord.sink.failEdit = { code: 50013 };
	const errors = console.error;
	console.error = () => {};
	try {
		await tracker.workflowRun(runEvent(sha(1), "in_progress"));
		await tracker.flush();
		discord.sink.failEdit = undefined;
		await tracker.flush();
		assert.doesNotMatch(discord.messages.get("m1")!, /— running/, "Still waiting for the retry delay");
		advance(10_000);
		await tracker.flush();
	} finally {
		console.error = errors;
	}
	assert.equal(discord.sent.length, 1);
	assert.match(discord.messages.get("m1")!, /— running/);
	discord.messages.delete("m1");
	await tracker.workflowRun(runEvent(sha(1), "completed", "success"));
	await tracker.flush();
	assert.equal(discord.sent.length, 2);
	assert.equal((await store.get(push.id))!.messageId, "m2");
});

test("messages stay within Discord's limit and neutralize mentions and markdown", () => {
	const push: Push = {
		id: 1,
		repo: REPO,
		sha: sha(1),
		before: sha(0),
		pusher: "@everyone",
		commits: Array.from({ length: 100 }, (_, i) => ({ sha: sha(i), subject: `<@123> **bold** ${"x".repeat(150)}`, author: "a" })),
		compareUrl: "https://github.com/compare",
		forced: false,
		superseded: false,
		deployedVia: null,
		messageId: null,
		version: 1,
		renderedVersion: 0,
	};
	const { sections } = renderPush(push, [
		{ kind: "workflow", key: "1", status: "success", detail: { name: "CI", url: "https://github.com/run" } },
		{ kind: "artifact", key: "SneakyMail", status: "running", detail: { text: "Deploying **SneakyMail** `1` (paper-plugin) to 2 dev server(s)." } },
	]);
	const content = sections.join("\n");
	assert.ok(content.length <= 4000);
	const lines = sections[0].split("\n");
	assert.match(lines[1], /^…\d+ earlier commit\(s\) in the \[comparison\]/, "The oldest commits are hidden");
	assert.ok(lines.at(-1)!.includes(sha(99).slice(0, 7)), "The newest commit is shown last");
	assert.ok(!content.includes(sha(0).slice(0, 7)));
	assert.doesNotMatch(content, /✅ CI/, "Only the latest stage is shown");
	assert.match(content, /🔄 Deploying \*\*SneakyMail\*\*/);
	assert.doesNotMatch(content, /<@123>|@everyone/);
	assert.match(content, /\\\*\\\*bold\\\*\\\*/);
});

test("late workflow events never replace a newer run, attempt or phase", async () => {
	const { tracker, store } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	const stage = async () => (await store.stages((await store.recent(REPO, 1))[0].id))[0];
	await tracker.workflowRun(runEvent(sha(1), "completed", "failure"));
	await tracker.workflowRun(runEvent(sha(1), "completed", "success", { run_attempt: 2 }));
	await tracker.workflowRun(runEvent(sha(1), "in_progress"));
	await tracker.workflowRun(runEvent(sha(1), "queued", null, { run_attempt: 2 }));
	assert.equal((await stage()).status, "success");
	assert.equal((await stage()).detail.attempt, 2);
	await tracker.workflowRun(runEvent(sha(1), "queued", null, { run_attempt: 3 }));
	assert.equal((await stage()).status, "queued", "A new attempt starts over");
	await tracker.workflowRun(runEvent(sha(1), "completed", "success", { id: 70, run_attempt: 9 }));
	assert.equal((await stage()).detail.attempt, 3, "An older run never replaces a newer one");
	await tracker.workflowRun(runEvent(sha(1), "in_progress", null, { id: 80 }));
	assert.equal((await stage()).status, "running");
});

test("push details arriving after the deployment still include earlier pushes", async () => {
	const { tracker, store } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	// B is known only from CI when it deploys, so its `before` is still unknown.
	await tracker.workflowRun(runEvent(sha(2), "completed", "success"));
	assert.equal(await tracker.artifact({ repository: REPO, commit: sha(2).slice(0, 7) }, { id: "SneakyMail", status: "success", text: "Uploaded" }), true);
	let [b, a] = await store.recent(REPO, 10);
	assert.equal(a.deployedVia, null);
	await tracker.push(pushEvent(sha(2), sha(1)));
	[b, a] = await store.recent(REPO, 10);
	assert.equal(b.sha, sha(2));
	assert.equal(a.deployedVia, b.id);

	// The earlier push itself may also be reported only after the deployment.
	await tracker.push(pushEvent(sha(4), sha(3)));
	await tracker.artifact({ repository: REPO, commit: sha(4) }, { id: "SneakyMail", status: "success", text: "Uploaded" });
	await tracker.push(pushEvent(sha(3), sha(2)));
	const pushes = await store.recent(REPO, 10);
	const p3 = pushes.find((push) => push.sha === sha(3))!;
	const p4 = pushes.find((push) => push.sha === sha(4))!;
	assert.equal(p3.deployedVia, p4.id);
	assert.equal(pushes.find((push) => push.sha === sha(2))!.deployedVia, null, "B deployed itself");
});

test("earlier messages get the link once the later push's message exists", async () => {
	const { tracker, store, discord } = setup();
	await tracker.push(pushEvent(sha(1), sha(0)));
	await tracker.push(pushEvent(sha(2), sha(1)));
	await tracker.artifact({ repository: REPO, commit: sha(2) }, { id: "SneakyMail", status: "success", text: "Uploaded" });
	// Oldest first: A renders before B has a message to link to.
	await tracker.flush();
	const [b, a] = await store.recent(REPO, 10);
	assert.match(discord.messages.get(a.messageId!)!, /Deployed together with a later push\.$/m);
	await tracker.flush();
	assert.match(discord.messages.get(a.messageId!)!, new RegExp(`later push: https://discord.test/${b.messageId}`));
	assert.equal(discord.sent.length, 2);
});

test("GitHub repository URLs are parsed strictly", () => {
	assert.equal(githubRepo(`https://github.com/${REPO}`), REPO);
	assert.equal(githubRepo(`https://github.com/${REPO}.git`), REPO);
	assert.equal(githubRepo(`https://github.com/${REPO}/`), REPO);
	assert.equal(githubRepo("https://gitlab.com/a/b"), undefined);
	assert.equal(githubRepo("https://github.com/a/b/c"), undefined);
	assert.equal(githubRepo(undefined), undefined);
});

async function serve(options: { github?: string; watchtower?: string; ready?: boolean } = {}) {
	const app = express();
	const { store, tracker, discord } = setup();
	registerPushTrackingRoutes(app, async () => (options.ready === false ? undefined : { store, tracker }), {
		github: () => options.github,
		watchtower: () => options.watchtower,
	});
	app.use(express.json());
	const server = app.listen(0, "127.0.0.1");
	await new Promise((resolve) => server.once("listening", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url, store, tracker, discord, close: () => new Promise((resolve) => server.close(resolve)) };
}

function signed(secret: string, body: string, event: string, delivery = crypto.randomUUID()) {
	return {
		method: "POST",
		body,
		headers: {
			"Content-Type": "application/json",
			"X-GitHub-Event": event,
			"X-GitHub-Delivery": delivery,
			"X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
		},
	};
}

test("GitHub receiver verifies signatures over the raw body and deduplicates deliveries", async () => {
	const app = await serve({ github: "secret" });
	try {
		const body = JSON.stringify(pushEvent(sha(1), sha(0)));
		assert.equal((await fetch(`${app.url}/github`, { ...signed("wrong", body, "push") })).status, 401);
		const tampered = signed("secret", body, "push");
		assert.equal((await fetch(`${app.url}/github`, { ...tampered, body: body.replace("DaniDipp", "Mallory") })).status, 401);
		const reformatted = JSON.stringify(JSON.parse(body), null, 2);
		assert.equal((await fetch(`${app.url}/github`, signed("secret", reformatted, "push", "delivery-1"))).status, 202, "Signature covers exact bytes");
		assert.equal((await fetch(`${app.url}/github`, signed("secret", reformatted, "push", "delivery-1"))).status, 200);
		assert.equal((await fetch(`${app.url}/github`, signed("secret", "{}", "ping"))).status, 200);
		assert.equal((await fetch(`${app.url}/github`, signed("secret", "{}", "issues"))).status, 204);
		assert.equal((await fetch(`${app.url}/github`, signed("secret", "not json", "push"))).status, 400);
		assert.equal((await fetch(`${app.url}/github`, signed("secret", "{}", "push", "delivery-2"))).status, 400);
		assert.equal(await app.store.claimDelivery("delivery-2", "github"), true, "Rejected deliveries can be redelivered");
		assert.equal((await fetch(`${app.url}/github`, signed("secret", JSON.stringify(runEvent(sha(1), "queued")), "workflow_run"))).status, 202);
		await app.tracker.flush();
		assert.equal(app.discord.sent.length, 1);
		assert.match(app.discord.messages.get("m1")!, /CI/);
	} finally {
		await app.close();
	}
	const disabled = await serve();
	try {
		assert.equal((await fetch(`${disabled.url}/github`, signed("secret", "{}", "push"))).status, 503);
	} finally {
		await disabled.close();
	}
	const unavailable = await serve({ github: "secret", ready: false });
	try {
		assert.equal((await fetch(`${unavailable.url}/github`, signed("secret", "{}", "push"))).status, 503);
	} finally {
		await unavailable.close();
	}
});

test("Watchtower receiver requires the bearer token and accepts JSON sent as text/plain", async () => {
	const app = await serve({ watchtower: "token" });
	try {
		const body = JSON.stringify({ report: { updated: [{ name: "wikijs", imageName: "registry/wikijs:latest" }] } });
		const post = (authorization: string, content = body) =>
			fetch(`${app.url}/watchtower`, { method: "POST", body: content, headers: { "Content-Type": "text/plain", Authorization: authorization } });
		assert.equal((await post("Bearer nope")).status, 401);
		assert.equal((await post("Bearer token", "garbage")).status, 400);
		assert.equal((await post("Bearer token", JSON.stringify({ report: { updated: [{}] } }))).status, 400);
		assert.equal((await post("Bearer token")).status, 202);
		assert.deepEqual(app.discord.sent, ["🐳 Updated container `wikijs` (`registry/wikijs:latest`)."]);
	} finally {
		await app.close();
	}
});

test("signature check rejects missing and malformed headers", () => {
	const body = Buffer.from("{}");
	assert.equal(validSignature("s", body, undefined), false);
	assert.equal(validSignature("s", body, "sha256=00"), false);
	assert.equal(validSignature("s", body, `sha256=${createHmac("sha256", "s").update(body).digest("hex")}`), true);
});
