import assert from "node:assert/strict";
import { test } from "node:test";
import { SQL } from "bun";
import { migrate, PostgresPushStore } from "../src/PushTracking/postgres.ts";
import { MemoryPushStore, type PushStore } from "../src/PushTracking/store.ts";
import { PushTracker } from "../src/PushTracking/tracker.ts";

// Set to a disposable database, e.g. postgres://postgres:test@127.0.0.1:15432/postgres. The schema is dropped first.
const url = process.env.PUSH_TRACKING_TEST_DATABASE_URL;
const sha = (n: number) => n.toString(16).padStart(4, "0") + "c".repeat(36);
const details = (before: string | null) => ({
	before,
	pusher: "DaniDipp",
	commits: [{ sha: sha(1), subject: "Fix", author: "DaniDipp" }],
	compareUrl: null,
	forced: false,
});

async function contract(store: PushStore) {
	assert.equal(await store.claimDelivery("d1", "github"), true);
	assert.equal(await store.claimDelivery("d1", "github"), false);
	await store.releaseDelivery("d1");
	assert.equal(await store.claimDelivery("d1", "github"), true);

	// A workflow can create the push before GitHub's push event fills in the details.
	const placeholder = await store.upsertPush("Team-Sneakymouse/Repo", sha(1));
	assert.equal(placeholder.commits, null);
	const filled = await store.upsertPush("Team-Sneakymouse/Repo", sha(1), details(sha(0)));
	assert.equal(filled.id, placeholder.id);
	assert.deepEqual(filled.commits, details(null).commits);
	assert.equal(filled.before, sha(0));
	assert.ok(filled.version > placeholder.version);
	const again = await store.upsertPush("team-sneakymouse/repo", sha(1));
	assert.equal(again.id, placeholder.id, "Repository names match case-insensitively");
	assert.equal(again.repo, "Team-Sneakymouse/Repo");

	const second = await store.upsertPush("Team-Sneakymouse/Repo", sha(2), details(sha(1)));
	await store.upsertPush("Team-Sneakymouse/Other", sha(3));
	assert.equal((await store.findByCommit("TEAM-SNEAKYMOUSE/REPO", sha(2).slice(0, 7)))?.id, second.id);
	assert.equal((await store.findByCommit("Team-Sneakymouse/Repo", sha(1).toUpperCase()))?.id, placeholder.id);
	assert.equal(await store.findByCommit("Team-Sneakymouse/Repo", sha(3)), undefined);
	assert.deepEqual(
		(await store.recent("Team-Sneakymouse/Repo", 5)).map((push) => push.id),
		[second.id, placeholder.id],
	);

	await store.setStage(second.id, { kind: "workflow", key: "5", status: "running", detail: { name: "CI", attempt: 1 } });
	await store.setStage(second.id, { kind: "workflow", key: "5", status: "success", detail: { name: "CI", attempt: 2 } });
	await store.setStage(second.id, { kind: "container", key: "app", status: "success", detail: {} });
	await store.setStage(second.id, { kind: "artifact", key: "Repo", status: "success", detail: { text: "Uploaded" } });
	await store.setStage(second.id, { kind: "workflow", key: "5", status: "success", detail: { name: "CI", attempt: 2 } });
	assert.deepEqual(
		(await store.stages(second.id)).map((stage) => stage.kind),
		["workflow", "artifact", "container"],
		"Updating a stage does not move its line",
	);
	await store.setStage(second.id, { kind: "container", key: "app", status: "skipped", detail: {} });
	assert.deepEqual(await store.stages(second.id), [
		{ kind: "workflow", key: "5", status: "success", detail: { name: "CI", attempt: 2 } },
		{ kind: "artifact", key: "Repo", status: "success", detail: { text: "Uploaded" } },
		{ kind: "container", key: "app", status: "skipped", detail: {} },
	]);

	const pending = await store.pendingRenders(10);
	assert.ok(pending.some((push) => push.id === second.id));
	const current = (await store.get(second.id))!;
	await store.setMessage(second.id, "123");
	await store.rendered(second.id, current.version);
	const rendered = (await store.get(second.id))!;
	assert.equal(rendered.messageId, "123");
	assert.equal(rendered.version, current.version, "Storing the message ID does not request another render");
	assert.ok(!(await store.pendingRenders(10)).some((push) => push.id === second.id));

	await store.mark(placeholder.id, { deployedVia: second.id });
	await store.mark(placeholder.id, { superseded: true });
	const marked = (await store.get(placeholder.id))!;
	assert.equal(marked.deployedVia, second.id, "Marks only change the fields they name");
	assert.equal(marked.superseded, true);
	// A render of an older version cannot hide a newer change.
	await store.rendered(placeholder.id, marked.version - 1);
	assert.ok((await store.pendingRenders(10)).some((push) => push.id === placeholder.id));
	await store.rendered(placeholder.id, marked.version);
	await store.rendered(placeholder.id, 1);
	assert.ok(!(await store.pendingRenders(10)).some((push) => push.id === placeholder.id));
	assert.equal(await store.get(9999), undefined);
}

test("memory store follows the store contract", async () => {
	await contract(new MemoryPushStore());
});

test("PostgreSQL store follows the store contract and migrations are repeatable", { skip: !url && "set PUSH_TRACKING_TEST_DATABASE_URL" }, async () => {
	// Pass every setting explicitly: Bun loads .env, and PG* variables would otherwise fill in the gaps.
	const target = new URL(url!);
	const sql = new SQL({
		hostname: target.hostname,
		port: Number(target.port || 5432),
		database: target.pathname.slice(1),
		username: decodeURIComponent(target.username),
		password: decodeURIComponent(target.password),
	});
	const [{ database }] = await sql<{ database: string }>`select current_database() as database`;
	assert.equal(database, target.pathname.slice(1));
	try {
		await sql.unsafe("drop schema if exists push_tracking cascade");
		await migrate(sql);
		await Promise.all([migrate(sql), migrate(sql)]);
		const [{ versions }] = await sql<{ versions: number }>`select count(*)::integer as versions from push_tracking.migrations`;
		assert.equal(versions, 1);
		const store = new PostgresPushStore(sql);
		await contract(store);
		await sql`update push_tracking.deliveries set received_at = now() - interval '40 days' where id = 'd1'`;
		await store.pruneDeliveries(30);
		assert.equal(await store.claimDelivery("d1", "github"), true, "Old delivery IDs are pruned");

		// End to end through the tracker: push → CI → deployment, rendered into one message.
		const messages = new Map<string, string>();
		const tracker = new PushTracker(store, {
			async send(content) {
				const id = String(messages.size + 1);
				messages.set(id, content);
				return id;
			},
			async edit(id, content) {
				messages.set(id, content);
			},
			link: (id) => id,
		});
		const repo = "Team-Sneakymouse/EndToEnd";
		await tracker.push({
			ref: "refs/heads/main",
			before: sha(10),
			after: sha(11),
			commits: [{ id: sha(11), message: "Add feature" }],
			repository: { full_name: repo, default_branch: "main" },
		});
		await tracker.workflowRun({
			action: "completed",
			workflow_run: { id: 1, workflow_id: 2, name: "CI", head_sha: sha(11), head_branch: "main", event: "push", status: "completed", conclusion: "success" },
			repository: { full_name: repo, default_branch: "main" },
		});
		assert.equal(
			await tracker.artifact({ repository: repo, commit: sha(11).slice(0, 7) }, { id: "EndToEnd", status: "success", text: "Uploaded **EndToEnd**" }),
			true,
		);
		await tracker.flush();
		await tracker.flush();
		const rendered = [...messages.values()].filter((content) => content.includes(repo));
		assert.equal(rendered.length, 1, "One message per push, edited in place");
		assert.match(rendered[0], /^✅ .*Add feature\n✅ CI · CI — success\n✅ Uploaded \*\*EndToEnd\*\*$/s);
	} finally {
		await sql.unsafe("drop schema if exists push_tracking cascade");
		await sql.close();
	}
});
