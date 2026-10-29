import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { TodoManagement, renderManagement } from "../src/todo/management.js";
const guild = "391355330241757205";
const labels = Array.from({ length: 37 }, (_, i) => ({ id: `l${i}`, name: `Label ${String(i).padStart(2, "0")}`, repo: "", description: "Description" }));
const groups = [{ id: "g", name: "Owner", labels: ["l0"], child_groups: [], assigned_user_id: "123" }];
function interaction(action: string, id = "", page = 0, extras: any = {}) {
	const sent: any[] = [];
	const events: string[] = [];
	return {
		guildId: guild,
		user: { id: "123" },
		client: { user: { id: "bot" } },
		message: { author: { id: "bot" } },
		customId: `todo-manage|123|${action}|${id}|${page}`,
		values: [],
		reply: async (p: any) => sent.push(p),
		editReply: async (p: any) => sent.push(p),
		deferUpdate: async () => events.push("ack"),
		deferReply: async () => events.push("ack"),
		showModal: async (p: any) => sent.push(p),
		sent,
		events,
		...extras,
	} as any;
}
test("management browser paginates all 37 labels without losing exact identifiers and exposes create/edit", () => {
	const first = renderManagement(labels, groups, "123", "labels", "", 0);
	const last = renderManagement(labels, groups, "123", "labels", "", 1);
	expect(first.components[1].components[0].options).toHaveLength(25);
	expect(last.components[1].components[0].options).toHaveLength(12);
	expect(last.components[1].components[0].options.at(-1).value).toBe("l36");
	expect(JSON.stringify(first.components)).toContain("New label");
	const group = renderManagement(labels, groups, "123", "group", "g");
	expect(group.components.some((r: any) => r.components.some((c: any) => c.type === 5))).toBe(true);
	expect(JSON.stringify(group.components)).toContain("Nested groups");
});
test("management callbacks acknowledge before IO, edit via modal, atomically link/unlink, and assign a selected Discord user", async () => {
	const calls: any[] = [];
	let current: any;
	const repo = {
		labels: async () => {
			expect(current.events).toEqual(["ack"]);
			return labels;
		},
		groups: async () => groups,
		operation: async (action: string, b: any) => {
			expect(current.events).toEqual(["ack"]);
			calls.push({ action, ...b });
			return { id: b.id ?? "new" };
		},
	};
	const manager = new TodoManagement(repo as any);
	current = interaction("labels", "", 1);
	await manager.component(current);
	expect(current.sent[0].components[1].components[0].options).toHaveLength(12);
	current = interaction("edit-label", "l0", 0, { message: { author: { id: "bot" }, embeds: renderManagement(labels, groups, "123", "label", "l0").embeds } });
	await manager.component(current);
	expect(current.sent[0].components).toHaveLength(3);
	const modalId = current.sent[0].custom_id;
	current = interaction("save-label", "l0", 0, {
		customId: modalId,
		fields: { getTextInputValue: (k: string) => (({ name: "Exact new name", repo: "", description: "New description" }) as any)[k] },
	});
	await manager.modal(current);
	expect(calls[0]).toMatchObject({ action: "manage-label", id: "l0", name: "Exact new name", guild_id: guild, actor: "123" });
	for (const action of ["link-label", "unlink-label"]) {
		current = interaction(action, "g", 0, { values: ["l36"] });
		await manager.component(current);
		expect(calls.at(-1).membership).toEqual({ field: "labels", operation: action.startsWith("unlink") ? "unlink" : "link", id: "l36" });
	}
	current = interaction("assign", "g", 0, { values: ["456"] });
	await manager.component(current);
	expect(calls.at(-1).assigned_user_id).toBe("456");
	current = interaction("clear-user", "g");
	await manager.component(current);
	expect(calls.at(-1).assigned_user_id).toBe("");
});
test("new group modal creates a group then renders user assignment and nested membership controls", async () => {
	let gs: any[] = [];
	const manager = new TodoManagement({
		labels: async () => labels,
		groups: async () => gs,
		operation: async (action: string, p: any) => {
			expect(action).toBe("manage-group");
			expect(p).toMatchObject({ name: "New group", actor: "123", guild_id: guild });
			gs = [{ id: "new", name: p.name, labels: [], child_groups: [] }];
			return gs[0];
		},
	} as any);
	const open = interaction("new-group");
	await manager.component(open);
	expect(open.sent[0].components).toHaveLength(1);
	const save = interaction("save-group", "", 0, { fields: { getTextInputValue: () => "New group" } });
	await manager.modal(save);
	expect(save.sent[0].embeds[0].title).toBe("New group");
	expect(save.sent[0].components[0].components[0].type).toBe(5);
});
test("label edit modals preserve literal placeholder-like text, while truly empty values stay empty", async () => {
	const manager = new TodoManagement({} as any);
	for (const description of ["No description configured.", ""]) {
		const view = renderManagement([{ id: "l", name: "Label", repo: "", description }], [], "123", "label", "l");
		const i = interaction("edit-label", "l", 0, { message: { author: { id: "bot" }, embeds: view.embeds } });
		await manager.component(i);
		expect(i.sent[0].components[2].components[0].value ?? "").toBe(description);
		expect(i.sent[0].components[1].components[0].value ?? "").toBe("");
	}
});
test("editing a long description never silently truncates saved content", async () => {
	const manager = new TodoManagement({} as any);
	const i = interaction("edit-label", "l0", 0, {
		message: {
			author: { id: "bot" },
			embeds: [
				{
					title: "Label",
					description: "Preview",
					fields: [{ name: "Repository", value: "Not configured" }],
					footer: { text: "management-description-too-long" },
				},
			],
		},
	});
	await manager.component(i);
	expect(i.sent[0].content).toContain("4000");
	expect(i.sent[0].components).toBeUndefined();
});
test("management rejects other users, foreign guilds and forged message authors before reads or mutations", async () => {
	const manager = new TodoManagement({
		labels: async () => {
			throw new Error("Must not read");
		},
	} as any);
	for (const extra of [{ user: { id: "456" } }, { guildId: "foreign" }, { message: { author: { id: "forged" } } }]) {
		const i = interaction("labels", "", 0, extra);
		await manager.component(i);
		expect(i.sent[0].content).toContain("Only");
	}
	const modal = interaction("save-label", "l0", 0, { user: { id: "456" } });
	await manager.modal(modal);
	expect(modal.sent[0].content).toContain("Only");
});

test("group name modals retain the original metadata fingerprint while member controls stay atomic", async () => {
	const calls: any[] = [];
	const manager = new TodoManagement({
		operation: async (action: string, b: any) => {
			calls.push({ action, ...b });
			throw new Error("Stale management edit");
		},
	} as any);
	const view = renderManagement(labels, groups, "123", "group", "g");
	const open = interaction("edit-group", "g", 0, { message: { author: { id: "bot" }, embeds: view.embeds } });
	await manager.component(open);
	const expected = createHash("sha256")
		.update(JSON.stringify(["Owner"]))
		.digest("hex")
		.slice(0, 32);
	expect(open.sent[0].custom_id.split("|")[4]).toBe(expected);
	const submit = interaction("save-group", "g", 0, { customId: open.sent[0].custom_id, fields: { getTextInputValue: () => "Stale group rename" } });
	await manager.modal(submit);
	expect(calls[0]).toMatchObject({ action: "manage-group", id: "g", expected_metadata: expected, name: "Stale group rename" });
	expect(calls[0].labels).toBeUndefined();
	expect(calls[0].assigned_user_id).toBeUndefined();
	expect(submit.sent[0].content).toContain("reopen /todo manage");
});
test("legacy edit modals without preconditions fail closed before writing", async () => {
	let writes = 0;
	const manager = new TodoManagement({
		operation: async () => {
			writes++;
		},
	} as any);
	for (const action of ["save-label", "save-group"]) {
		const submit = interaction(action, "old", 0, { fields: { getTextInputValue: () => "Old" } });
		await manager.modal(submit);
		expect(submit.sent[0].content).toContain("reopen /todo manage");
	}
	expect(writes).toBe(0);
});
test("two open label editors carry persistent preconditions and cannot restore stale repo/long description", async () => {
	let label = { id: "abcdefghijklmn1", name: "Original 雪", repo: "https://github.com/Team/Old", description: 'Old "description"\n😀' };
	const calls: any[] = [];
	const fingerprint = () =>
		createHash("sha256")
			.update(JSON.stringify([label.name, label.repo, label.description]))
			.digest("hex")
			.slice(0, 32);
	const repo = {
		labels: async () => [label],
		groups: async () => [],
		operation: async (_: string, b: any) => {
			calls.push(b);
			if (b.expected_metadata !== fingerprint()) throw new Error("Stale metadata");
			label = { ...label, name: b.name, repo: b.repo, description: b.description };
			return label;
		},
	};
	const owner = "12345678901234567890";
	const view = renderManagement([label], [], owner, "label", label.id);
	const editors = [];
	for (let n = 0; n < 2; n++) {
		const open = interaction("edit-label", label.id, 0, {
			user: { id: owner },
			customId: `todo-manage|${owner}|edit-label|${label.id}|0`,
			message: { author: { id: "bot" }, embeds: view.embeds },
		});
		await new TodoManagement(repo as any).component(open);
		editors.push(open.sent[0]);
	}
	expect(editors[0].custom_id.length).toBeLessThanOrEqual(100);
	// A trusted second editor may save values too long for a Discord modal.
	const baseline = editors[1].custom_id.split("|")[4];
	expect(baseline).toBe(fingerprint());
	await repo.operation("manage-label", { expected_metadata: baseline, name: label.name, repo: "https://github.com/Team/New", description: "雪".repeat(5000) });
	const current = { ...label };
	// Reconstructing the controller models a restart: the custom ID carries all precondition state.
	const submit = interaction("", label.id, 0, {
		user: { id: owner },
		customId: editors[0].custom_id,
		fields: {
			getTextInputValue: (key: string) => (({ name: "Stale rename", repo: "https://github.com/Team/Old", description: 'Old "description"\n😀' }) as any)[key],
		},
	});
	await new TodoManagement(repo as any).modal(submit);
	expect(calls.at(-1).expected_metadata).toBe(baseline);
	expect(label).toEqual(current);
	expect(submit.sent[0].content).toContain("reopen /todo manage");
});
