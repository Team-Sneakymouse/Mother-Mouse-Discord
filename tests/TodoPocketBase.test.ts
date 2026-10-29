import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import PocketBase from "pocketbase";
import { MessageFlags } from "discord.js";
import { TodoController } from "../src/Todo.js";
import { TodoRepository, TodoService } from "../src/todo/service.js";
import { renderManagement } from "../src/todo/management.js";
const binary = process.env.TODO_PB_BINARY;
const integration = binary ? test : test.skip;
let processPB: ChildProcess;
let directory: string;
let pb: PocketBase;
let label: string;
let report: string;
let logs = "";
beforeAll(async () => {
	if (!binary) return;
	directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "todo-pb-"));
	const admin = spawn(binary, ["superuser", "create", "tests@example.com", "test-password-12345", "--dir", directory]);
	await new Promise<void>((resolve, reject) => admin.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("create superuser failed")))));
	const port = 18000 + Math.floor(Math.random() * 10000);
	processPB = spawn(binary, ["serve", "--http", `127.0.0.1:${port}`, "--dir", directory, "--hooksDir", resolve("pocketbase/pb_hooks")]);
	processPB.stdout?.on("data", (d) => (logs += d));
	processPB.stderr?.on("data", (d) => (logs += d));
	pb = new PocketBase(`http://127.0.0.1:${port}`);
	pb.autoCancellation(false);
	for (let i = 0; i < 100; i++) {
		try {
			await pb.health.check();
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 50));
		}
	}
	await pb.collection("_superusers").authWithPassword("tests@example.com", "test-password-12345");
	await pb.collections.import(JSON.parse(await readFile("pocketbase/todo.collections.json", "utf8")), false);
	label = (
		await pb
			.collection("todo_list_labels")
			.create({ guild_id: "g", name: "Plugin", description: "Plugin", thread_id: "thread", repo: "https://github.com/Team/Plugin" })
	).id;
}, 20000);
afterAll(async () => {
	processPB?.kill();
	if (directory) await rm(directory, { recursive: true, force: true });
});
async function api(action: string, body: unknown) {
	return pb.send<any>(`/api/shared-todo/${action}`, { method: "POST", body });
}
integration("concurrent capture rejects duplicates with existing identity and preserves complete source snapshots", async () => {
	const body = {
		guild_id: "g",
		channel_id: "c",
		message_id: "m",
		source: { url: "https://discord.com/channels/g/c/m", sender_id: "u", created_by: "a" },
		context: { complete: true, messages: [] },
		context_text: "context",
	};
	const results = await Promise.allSettled([api("capture", body), api("capture", body)]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	const a = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
	report = a.id;
	const failure = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
	expect(failure.message).toContain(`Already reported: report ${a.id} · pending`);
	expect(failure.message).toContain(body.source.url);
	expect(await pb.collection("todo_list_reports").getFullList()).toHaveLength(1);
	expect((await pb.collection("todo_list_reports").getOne(a.id)).source.created_by).toBe("a");
	const guest = new PocketBase(pb.baseURL);
	await expect(guest.collection("todo_list_reports").getOne(a.id)).rejects.toThrow();
});
integration("assessment atomically splits and merges, allocates monotonic numbers across concurrent requests; rollback is retry safe", async () => {
	const begin = await api("assess-begin", { id: report, actor: "a" });
	const create = { action: "create", label, kind: "bug", priority: "red", title: "Crash", description: "Cannot play", confidence: 0.9, reason: "Crash" };
	await expect(
		api("assess-commit", { id: report, token: begin.token, rules_version: "v1", decisions: [create, { ...create, label: "invalid" }] }),
	).rejects.toThrow();
	expect((await pb.collection("todo_list_todos").getFullList()).length).toBe(0);
	const done = await api("assess-commit", {
		id: report,
		token: begin.token,
		rules_version: "v1",
		decisions: [create, { ...create, title: "Other" }, { ...create, confidence: 0.69 }],
	});
	expect(done.state).toBe("needs_clarification");
	expect(done.todos).toHaveLength(2);
	const todos = await pb.collection("todo_list_todos").getFullList({ sort: "number" });
	expect(todos.map((t) => t.number)).toEqual([1, 2]);
	await expect(api("assess-commit", { id: report, token: begin.token, rules_version: "v1", decisions: [create] })).rejects.toThrow();
	const captures = await Promise.all(
		["m2", "m3"].map((message_id) =>
			api("capture", { guild_id: "g", channel_id: "c", message_id, source: {}, context: { complete: true }, context_text: "x" }),
		),
	);
	await Promise.all(
		captures.map(async (r, i) => {
			const b = await api("assess-begin", { id: r.id, actor: "a" });
			return api("assess-commit", {
				id: r.id,
				token: b.token,
				rules_version: "v1",
				decisions: [i === 0 ? create : { action: "merge", todo: todos[0].id, confidence: 0.9, reason: "Same" }],
			});
		}),
	);
	expect((await pb.collection("todo_list_todos").getFullList({ sort: "number" })).map((t) => t.number)).toEqual([1, 2, 3]);
});
integration("atomic claims prevent double start across clients; reopen clears claim but preserves work and audit", async () => {
	const todo = (await pb.collection("todo_list_todos").getFullList({ sort: "number" }))[0];
	const results = await Promise.allSettled([api("claim", { id: todo.id, actor: "dev1" }), api("claim", { id: todo.id, actor: "dev2" })]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	const success = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>;
	await api("claim-finish", { id: todo.id, token: success.value.claim.token, message_id: "handoff" });
	await pb.collection("todo_list_todos").update(todo.id, { status: "done", work: { notes: "kept" }, pr_links: ["https://github.com/t/r/pull/1"] });
	const reopened = await api("reopen", { number: todo.number, guild_id: "g", actor: "dev", reason: "Regression" });
	expect(reopened.status).toBe("open");
	expect(reopened.claim).toEqual({});
	expect(reopened.work).toEqual({ notes: "kept" });
	expect(reopened.pr_links).toHaveLength(1);
	expect(reopened.audit.at(-1).actor).toBe("dev");
	const noop = await api("reopen", { number: todo.number, guild_id: "g", actor: "dev" });
	expect(noop.audit).toEqual(reopened.audit);
});
integration("server rejects label group cycles and cross-guild descendants", async () => {
	const a = await pb.collection("todo_list_label_groups").create({ guild_id: "g", name: "Root", labels: [label], child_groups: [] });
	const b = await pb.collection("todo_list_label_groups").create({ guild_id: "g", name: "Child", labels: [label], child_groups: [a.id] });
	await expect(pb.collection("todo_list_label_groups").update(a.id, { child_groups: [b.id] })).rejects.toThrow();
	const foreign = await pb.collection("todo_list_label_groups").create({ guild_id: "foreign", name: "Foreign", labels: [], child_groups: [] });
	await expect(pb.collection("todo_list_label_groups").update(a.id, { child_groups: [foreign.id] })).rejects.toThrow();
});
integration("management creates and edits labels/groups, preserves memberships on metadata changes and rejects foreign guilds/cycles", async () => {
	const l = await api("manage-label", { guild_id: "mg", name: "Managed", repo: "", description: "Known", actor: "123" });
	const a = await api("manage-group", { guild_id: "mg", name: "Owned", labels: [l.id], child_groups: [], assigned_user_id: "123", actor: "123" });
	expect(a.assigned_user_id).toBe("123");
	const changed = await api("manage-group", { guild_id: "mg", id: a.id, name: "Renamed", actor: "123" });
	expect(changed.labels).toEqual([l.id]);
	expect(changed.assigned_user_id).toBe("123");
	const b = await api("manage-group", { guild_id: "mg", name: "Child", labels: [], child_groups: [a.id], actor: "123" });
	await expect(api("manage-group", { guild_id: "mg", id: a.id, child_groups: [b.id], actor: "123" })).rejects.toThrow();
	await expect(api("manage-label", { guild_id: "other", id: l.id, name: "Hijacked", actor: "123" })).rejects.toThrow();
	await expect(api("manage-group", { guild_id: "mg", id: a.id, labels: [label], actor: "123" })).rejects.toThrow();
	await expect(api("manage-group", { guild_id: "mg", id: a.id, assigned_user_id: "not-a-user", actor: "123" })).rejects.toThrow();
	const cleared = await api("manage-group", { guild_id: "mg", id: a.id, assigned_user_id: "", actor: "123" });
	expect(cleared.assigned_user_id).toBe("");
	expect((await pb.collection("todo_list_label_groups").getOne(a.id)).labels).toEqual([l.id]);
});
integration("management preconditions transactionally reject stale label snapshots without partial name/repo/description writes", async () => {
	const l = await api("manage-label", {
		guild_id: "optimistic",
		actor: "123",
		name: "Original 雪",
		repo: "https://github.com/Team/Old",
		description: 'Old "description"\n😀',
	});
	const token = (r: any) => JSON.parse(renderManagement([r], [], "123", "label", r.id).embeds[0].footer.text.slice(17)).metadata;
	const baseline = token(l);
	// Two independent HTTP requests share a persisted original snapshot; exactly one may commit.
	const outcomes = await Promise.allSettled(
		["A", "B"].map((s) =>
			api("manage-label", {
				guild_id: "optimistic",
				actor: "123",
				id: l.id,
				expected_metadata: baseline,
				name: `Winner ${s}`,
				repo: `https://github.com/Team/${s}`,
				description: s.repeat(5000),
			}),
		),
	);
	expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	const saved = (outcomes.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
	await expect(
		api("manage-label", {
			guild_id: "optimistic",
			actor: "123",
			id: l.id,
			expected_metadata: baseline,
			name: "Stale name",
			repo: l.repo,
			description: l.description,
		}),
	).rejects.toThrow("Stale management edit");
	const current = await pb.collection("todo_list_labels").getOne(l.id);
	expect(current.name).toBe(saved.name);
	expect(current.repo).toBe(saved.repo);
	expect(current.description).toBe(saved.description);
	expect(current.description).toHaveLength(5000);
	// Exact original-value matches work, and omitted metadata stays untouched.
	const renamed = await api("manage-label", {
		guild_id: "optimistic",
		actor: "123",
		id: l.id,
		expected_metadata: token({ ...current, description: "short" }),
		name: "Invalid",
	}).catch((e) => e);
	expect(renamed).toBeInstanceOf(Error);
	await expect(api("manage-label", { guild_id: "optimistic", actor: "123", id: l.id, expected_metadata: null, name: "Invalid" })).rejects.toThrow();
	// Use an unchanged long description's hash, not its truncated display preview.
	const { createHash } = await import("node:crypto");
	const expected = createHash("sha256")
		.update(JSON.stringify([current.name, current.repo, current.description]))
		.digest("hex")
		.slice(0, 32);
	const exact = await api("manage-label", { guild_id: "optimistic", actor: "123", id: l.id, expected_metadata: expected, name: "Fresh name" });
	expect(exact.name).toBe("Fresh name");
	expect(exact.repo).toBe(saved.repo);
	expect(exact.description).toBe(saved.description);
});
integration("group name preconditions ignore independent membership/assignment changes but reject stale renames atomically", async () => {
	const l = await api("manage-label", { guild_id: "optimistic-group", actor: "123", name: "Member" });
	const g = await api("manage-group", {
		guild_id: "optimistic-group",
		actor: "123",
		name: "Original group",
		labels: [],
		child_groups: [],
		assigned_user_id: "123",
	});
	const view = renderManagement([], [g], "123", "group", g.id);
	const expected_metadata = JSON.parse(view.embeds[0].footer.text.slice(17)).metadata;
	await Promise.all([
		api("manage-group", { guild_id: g.guild_id, actor: "123", id: g.id, membership: { field: "labels", operation: "link", id: l.id } }),
		api("manage-group", { guild_id: g.guild_id, actor: "123", id: g.id, assigned_user_id: "456" }),
	]);
	const renamed = await api("manage-group", { guild_id: g.guild_id, actor: "123", id: g.id, expected_metadata, name: "New group" });
	expect(renamed.labels).toEqual([l.id]);
	expect(renamed.assigned_user_id).toBe("456");
	await expect(
		api("manage-group", {
			guild_id: g.guild_id,
			actor: "123",
			id: g.id,
			expected_metadata,
			name: "Stale name",
			assigned_user_id: "789",
			membership: { field: "labels", operation: "unlink", id: l.id },
		}),
	).rejects.toThrow("Stale management edit");
	const current = await pb.collection("todo_list_label_groups").getOne(g.id);
	expect(current.name).toBe("New group");
	expect(current.labels).toEqual([l.id]);
	expect(current.assigned_user_id).toBe("456");
	expect(current.child_groups).toEqual([]);
});
integration("catalog seed is exact, idempotent with existing labels/groups and atomically refuses conflicts", async () => {
	const seed = JSON.parse(await readFile("pocketbase/todo.catalog.seed.json", "utf8"));
	expect(seed.labels).toHaveLength(37);
	expect(seed.groups).toHaveLength(7);
	const body = { ...seed, guild_id: "seed", actor: "123" };
	const result = await api("seed-catalog", body);
	expect(result.created_labels).toBe(37);
	expect(result.created_groups).toBe(7);
	const again = await api("seed-catalog", body);
	expect(again.created_labels).toBe(0);
	expect(again.created_groups).toBe(0);
	const gs = await pb.collection("todo_list_label_groups").getFullList({ filter: "guild_id='seed'" });
	const momo = gs.find((g) => g.name === "Momo")!;
	expect(momo.assigned_user_id).toBe("108296164599734272");
	expect(momo.child_groups.sort()).toEqual(
		gs
			.filter((g) => ["Oakley", "Bungo"].includes(g.name))
			.map((g) => g.id)
			.sort(),
	);
	const paper = gs.find((g) => g.name === "Paper plugins")!;
	expect(paper.labels).toHaveLength(32);
	const ls = await pb.collection("todo_list_labels").getFullList({ filter: "guild_id='seed'" });
	expect(paper.labels).toContain(ls.find((l) => l.name === "Mother Mouse Discord")!.id);
	expect(ls.find((l) => l.name === "SneakyWantedPosters")!.repo).toBe("");
	await expect(
		api("seed-catalog", {
			...body,
			labels: [
				{ name: "Must roll back", url: null, explanation: null },
				...body.labels.map((l: any) => (l.name === "BubbleChat" ? { ...l, explanation: "conflict" } : l)),
			],
		}),
	).rejects.toThrow();
	expect(await pb.collection("todo_list_labels").getFullList({ filter: "name='Must roll back'" })).toHaveLength(0);
	await pb.collection("todo_list_label_groups").update(momo.id, { assigned_user_id: "999" });
	await expect(api("seed-catalog", body)).rejects.toThrow();
	expect((await pb.collection("todo_list_label_groups").getOne(momo.id)).assigned_user_id).toBe("999");
});
integration("public numbers cannot be edited or reused after deleting highest numbered todo", async () => {
	const todos = await pb.collection("todo_list_todos").getFullList({ sort: "number" });
	await expect(pb.collection("todo_list_todos").update(todos[0].id, { number: 999 })).rejects.toThrow();
	await pb.collection("todo_list_todos").delete(todos.at(-1)!.id);
	const r = await api("capture", { guild_id: "g", channel_id: "c", message_id: "m-next", source: {}, context: { complete: true }, context_text: "x" });
	const begin = await api("assess-begin", { id: r.id, actor: "dev" });
	const done = await api("assess-commit", {
		id: r.id,
		token: begin.token,
		rules_version: "v1",
		decisions: [
			{ action: "create", label, kind: "feature", priority: "blue", title: "Feature", description: "New thing", confidence: 1, reason: "Explicit request" },
		],
	});
	expect((await pb.collection("todo_list_todos").getOne(done.todos[0])).number).toBe(4);
});
integration("human clarification preserves accepted split associations and adds only reviewed decisions", async () => {
	const r = (await pb.collection("todo_list_reports").getFullList({ filter: "state='needs_clarification'" }))[0];
	const previous = [...r.todos];
	const begin = await api("resolve-begin", { id: r.id, actor: "reviewer" });
	const resolved = await api("assess-commit", {
		id: r.id,
		token: begin.token,
		rules_version: "manual",
		decisions: [
			{
				action: "create",
				label,
				kind: "feature",
				priority: "blue",
				title: "Reviewed feature",
				description: "Reviewed request",
				confidence: 1,
				reason: "Confirmed with reporter",
			},
		],
	});
	expect(resolved.state).toBe("assessed");
	expect(resolved.todos).toHaveLength(previous.length + 1);
	expect(resolved.todos).toEqual(expect.arrayContaining(previous));
	expect(resolved.assessment.previous.decisions).toHaveLength(3);
});
for (const interruption of ["failure", "expiry"]) {
	integration(`human resolution ${interruption} blocks automatic reassessment and preserves accepted splits on manual retry`, async () => {
		const r = await api("capture", {
			guild_id: "g",
			channel_id: "c",
			message_id: `resolution-${interruption}`,
			source: {},
			context: { complete: true },
			context_text: "two issues",
		});
		const create = {
			action: "create",
			label,
			kind: "bug",
			priority: "yellow",
			title: `Accepted ${interruption}`,
			description: "Already accepted issue",
			confidence: 1,
			reason: "Confirmed evidence",
		};
		const initial = await api("assess-begin", { id: r.id, actor: "dev" });
		const partial = await api("assess-commit", {
			id: r.id,
			token: initial.token,
			rules_version: "v1",
			decisions: [create, { action: "clarify", confidence: 0.4, reason: "Need reporter input" }],
		});
		const accepted = await pb.collection("todo_list_todos").getOne(partial.todos[0]);
		const before = (await pb.collection("todo_list_todos").getFullList()).map((t) => t.id).sort();
		const resolving = await api("resolve-begin", { id: r.id, actor: "reviewer" });
		if (interruption === "failure") await api("assess-fail", { id: r.id, token: resolving.token, error: "Interrupted persistence" });
		else await pb.collection("todo_list_reports").update(r.id, { assessment: { ...resolving.report.assessment, started_ms: Date.now() - 600001 } });
		await expect(api("assess-begin", { id: r.id, actor: "automatic" })).rejects.toThrow("Resolve clarification manually");
		expect((await pb.collection("todo_list_reports").getOne(r.id)).todos).toEqual(partial.todos);
		const retry = await api("resolve-begin", { id: r.id, actor: "reviewer" });
		expect(retry.token).not.toBe(resolving.token);
		await expect(api("assess-commit", { id: r.id, token: resolving.token, rules_version: "manual", decisions: [create] })).rejects.toThrow();
		const resolved = await api("assess-commit", {
			id: r.id,
			token: retry.token,
			rules_version: "manual",
			decisions: [{ action: "dismiss", confidence: 1, reason: "Unresolved issue is expected gameplay" }],
		});
		expect(resolved.state).toBe("assessed");
		expect(resolved.todos).toEqual(partial.todos);
		expect(await pb.collection("todo_list_todos").getOne(accepted.id)).toEqual(accepted);
		expect((await pb.collection("todo_list_todos").getFullList()).map((t) => t.id).sort()).toEqual(before);
		expect((await pb.collection("todo_list_reports").getOne(r.id)).todos).toEqual(partial.todos);
	});
}
integration("done means PR ready and status changes preserve accumulated work and links", async () => {
	const t = (await pb.collection("todo_list_todos").getFullList({ filter: "status='open'" })).find((t) => !t.pr_links?.length)!;
	await expect(api("status", { id: t.id, actor: "dev", status: "done", reason: "Ready" })).rejects.toThrow();
	const ready = await api("status", {
		id: t.id,
		actor: "dev",
		status: "done",
		reason: "PR ready for review",
		pr: "https://github.com/Team/Plugin/pull/42",
		work: "Verified tests",
	});
	expect(ready.status).toBe("done");
	expect(ready.pr_links).toContain("https://github.com/Team/Plugin/pull/42");
	expect(ready.audit.at(-1).reason).toBe("PR ready for review");
});
integration("Start forum claim no longer requires a label developer thread and persists attempt context and new forum thread", async () => {
	const l = await pb
		.collection("todo_list_labels")
		.create({ guild_id: "g", name: "No old thread", description: "Plugin", repo: "https://github.com/Team/Plugin", thread_id: "" });
	const r = await api("capture", {
		guild_id: "g",
		channel_id: "c",
		message_id: "forum-report",
		source: {},
		context: { complete: true },
		context_text: "full context",
	});
	const begin = await api("assess-begin", { id: r.id, actor: "dev" });
	const assessed = await api("assess-commit", {
		id: r.id,
		token: begin.token,
		rules_version: "v1",
		decisions: [
			{ action: "create", label: l.id, kind: "feature", priority: "blue", title: "Forum task", description: "Feature", confidence: 1, reason: "Explicit" },
		],
	});
	const claimed = await api("claim", { id: assessed.todos[0], actor: "dev" });
	const prepared = await api("claim-context", { id: claimed.id, token: claimed.claim.token, prompt: "complete opening prompt" });
	expect(prepared.claim.prompt).toBe("complete opening prompt");
	const posted = await api("claim-thread", {
		id: claimed.id,
		token: claimed.claim.token,
		thread_id: "123456789",
		thread_url: "https://discord.com/channels/g/123456789",
	});
	expect(posted.claim.thread_id).toBe("123456789");
	expect(posted.claim.forum_id).toBe("1560943737688039474");
	expect(posted.audit.at(-1).thread_id).toBe("123456789");
});
integration("manual relabel and closed status audit old/new/reason and reject stale edits without requiring Hermes", async () => {
	const t = (await pb.collection("todo_list_todos").getFullList({ filter: "status='open'" }))[0];
	const other = await pb
		.collection("todo_list_labels")
		.create({ guild_id: "g", name: "Other plugin", description: "Other", repo: "https://github.com/Team/Other" });
	const revision = t.audit.length;
	const changed = await api("label", { id: t.id, label: other.id, actor: "dev", reason: "Correct plugin", expected_revision: revision });
	expect(changed.label).toBe(other.id);
	expect(changed.audit.at(-1)).toMatchObject({ event: "label_changed", old: t.label, new: other.id, actor: "dev", reason: "Correct plugin" });
	await expect(api("status", { id: t.id, status: "closed", actor: "dev", expected_revision: revision })).rejects.toThrow();
	const closed = await api("status", { id: t.id, status: "closed", actor: "dev", reason: "Fixed manually", expected_revision: changed.audit.length });
	expect(closed.status).toBe("closed");
	expect(closed.claim).toEqual({});
	expect((await api("reopen", { number: t.number, guild_id: "g", actor: "dev" })).status).toBe("open");
	const claimed = await api("claim", { id: t.id, actor: "dev" });
	await expect(api("status", { id: t.id, status: "closed", actor: "other", expected_revision: claimed.audit.length })).rejects.toThrow();
});
integration("claim-fail preserves a confirmed sent claim after a lost claim-finish response", async () => {
	const r = await api("capture", {
		guild_id: "g",
		channel_id: "c",
		message_id: "lost-finish",
		source: {},
		context: { complete: true },
		context_text: "full context",
	});
	const begin = await api("assess-begin", { id: r.id, actor: "dev" });
	const assessed = await api("assess-commit", {
		id: r.id,
		token: begin.token,
		rules_version: "v1",
		decisions: [
			{ action: "create", label, kind: "bug", priority: "red", title: "Lost response", description: "Accepted work", confidence: 1, reason: "Confirmed" },
		],
	});
	const claimed = await api("claim", { id: assessed.todos[0], actor: "dev" });
	const { id } = claimed;
	const token = claimed.claim.token;
	await api("claim-context", { id, token, prompt: "complete opening snapshot" });
	await api("claim-thread", { id, token, thread_id: "123456789", thread_url: "https://discord.com/channels/g/123456789" });
	const sent = await api("claim-finish", { id, token, message_id: "accepted-session" });
	expect(sent.claim).toMatchObject({
		phase: "sent",
		message_id: "accepted-session",
		prompt: "complete opening snapshot",
		thread_id: "123456789",
		developer: "dev",
		token,
	});
	for (const definitive of [false, true]) {
		const reconciled = await api("claim-fail", { id, token, definitive, error: "claim-finish response lost" });
		const persisted = await pb.collection("todo_list_todos").getOne(id);
		for (const result of [reconciled, persisted]) {
			expect(result.status).toBe("in_progress");
			expect(result.claim).toEqual(sent.claim);
			expect(result.audit).toEqual(sent.audit);
		}
		await expect(api("claim-fail", { id, token: "stale-token", definitive, error: "stale" })).rejects.toThrow("Claim lost");
		expect(await pb.collection("todo_list_todos").getOne(id)).toEqual(persisted);
	}
});
integration("failed assessment is retryable; ambiguous handoff is blocked with audited human recovery", async () => {
	const r = await api("capture", { guild_id: "g", channel_id: "c", message_id: "m-fail", source: {}, context: { complete: true }, context_text: "x" });
	const b = await api("assess-begin", { id: r.id, actor: "dev" });
	await api("assess-fail", { id: r.id, token: b.token, error: "Transport failed" });
	const retry = await api("assess-begin", { id: r.id, actor: "dev" });
	expect(retry.token).not.toBe(b.token);
	const done = await api("assess-commit", {
		id: r.id,
		token: retry.token,
		rules_version: "v1",
		decisions: [{ action: "dismiss", confidence: 1, reason: "Not actionable" }],
	});
	expect(done.state).toBe("dismissed");
	const t = (await pb.collection("todo_list_todos").getFullList({ filter: "status='open'" }))[0];
	const claimed = await api("claim", { id: t.id, actor: "dev" });
	const blocked = await api("claim-fail", { id: t.id, token: claimed.claim.token, definitive: false, error: "Timeout" });
	expect(blocked.status).toBe("blocked");
	await expect(api("claim", { id: t.id, actor: "other" })).rejects.toThrow();
	const recovered = await api("recover", { id: t.id, actor: "dev", message_id: "existing-session", reason: "Verified destination" });
	expect(recovered.status).toBe("in_progress");
	expect(recovered.claim.message_id).toBe("existing-session");
});

integration("Create report surfaces real HTTP duplicate errors privately in every report state without mutation", async () => {
	const guild = "391355330241757205",
		channelId = "duplicate-channel",
		messageId = "duplicate-message";
	const body = {
		guild_id: guild,
		channel_id: channelId,
		message_id: messageId,
		source: { content: "Original evidence" },
		context: { complete: true, messages: [] },
		context_text: "Original context",
	};
	const r = await api("capture", body);
	const controller = new TodoController(new TodoService(new TodoRepository(pb)));
	const original = {
		id: messageId,
		guildId: guild,
		channelId,
		createdTimestamp: 1000,
		author: { id: "sender", username: "alice" },
		content: "Changed evidence",
		attachments: new Map(),
		reference: null,
		url: `https://discord.com/channels/${guild}/${channelId}/${messageId}`,
	};
	const channel = { id: channelId, name: "bugs", isThread: () => false, messages: { fetch: async () => new Map([[messageId, original]]) } };
	const ownLabel = await pb.collection("todo_list_labels").create({ guild_id: guild, name: "Duplicate regression", description: "Test" });
	const begin = await api("assess-begin", { id: r.id, actor: "123" });
	const assessed = await api("assess-commit", {
		id: r.id,
		token: begin.token,
		rules_version: "test",
		decisions: [
			{
				action: "create",
				label: ownLabel.id,
				kind: "bug",
				priority: "yellow",
				title: "Duplicate",
				description: "Evidence",
				confidence: 1,
				reason: "Confirmed",
			},
		],
	});
	const activeTodo = await pb.collection("todo_list_todos").getOne(assessed.todos[0]);
	expect(activeTodo.status).toBe("open");
	for (const state of ["pending", "failed", "assessing", "needs_clarification", "assessed", "dismissed"]) {
		await pb.collection("todo_list_reports").update(r.id, { state, todos: [activeTodo.id] });
		const before = await pb.collection("todo_list_reports").getOne(r.id);
		const count = (await pb.collection("todo_list_reports").getFullList()).length;
		const sent: any[] = [];
		let deferred = false;
		const interaction = {
			guildId: guild,
			user: { id: "123", username: "dev" },
			targetMessage: { ...original, channel },
			get deferred() {
				return deferred;
			},
			replied: false,
			deferReply: async (p: any) => {
				expect(p.flags).toBe(MessageFlags.Ephemeral);
				deferred = true;
			},
			editReply: async (p: any) => {
				expect(deferred).toBe(true);
				sent.push(p);
			},
			reply: async () => {
				throw new Error("Must edit the private deferred reply");
			},
		};
		await controller.capture(interaction as any);
		expect(sent).toHaveLength(1);
		expect(sent[0].content).toContain(`Todo operation failed: Already reported: report ${r.id} · ${state}`);
		expect(sent[0].content).toContain("No new report was created");
		expect(sent[0].content).toContain(original.url);
		expect(sent[0].allowedMentions).toEqual({ parse: [] });
		expect(await pb.collection("todo_list_reports").getOne(r.id)).toEqual(before);
		expect(await pb.collection("todo_list_reports").getFullList()).toHaveLength(count);
	}
});
