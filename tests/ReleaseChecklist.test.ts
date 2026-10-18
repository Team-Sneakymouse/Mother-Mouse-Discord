import { expect, test } from "bun:test";
import ReleaseChecklist, { data } from "../src/ReleaseChecklist/index.js";
import { MAX_FEATURES, PREFIX, createReleaseQueue, readRelease, renderRelease, type Release } from "../src/ReleaseChecklist/card.js";

const empty = (): Release => ({ title: "Weekly *release* \\ #1", closed: false, features: [] });

function harness(initial = empty()) {
	let listener: (interaction: any) => Promise<void>;
	let wire = renderRelease(initial).components;
	const message = {
		id: "123",
		author: { id: "bot" },
		get components() {
			return wire.map((c) => ({ toJSON: () => c }));
		},
		async edit(payload: ReturnType<typeof renderRelease>) {
			wire = payload.components;
		},
	};
	const fetches: any[] = [];
	const client = {
		user: { id: "bot" },
		on: (_event: string, callback: typeof listener) => {
			listener = callback;
		},
	};
	const restart = () => ReleaseChecklist(client as any);
	restart();
	const interaction = (customId: string, kind = "button", name = "", values: string[] = []) => ({
		customId: PREFIX + customId,
		message,
		values,
		deferred: false,
		replied: false,
		channel: {
			messages: {
				fetch: async (options: any) => {
					fetches.push(options);
					return message;
				},
			},
		},
		fields: { getTextInputValue: () => name },
		isChatInputCommand: () => false,
		isButton: () => kind === "button",
		isStringSelectMenu: () => kind === "select",
		isModalSubmit: () => kind === "modal",
		responses: [] as any[],
		modal: undefined as any,
		async reply(payload: any) {
			this.replied = true;
			this.responses.push(payload);
		},
		async deferReply() {
			this.deferred = true;
		},
		async editReply(payload: any) {
			this.responses.push(payload);
		},
		async showModal(modal: any) {
			this.replied = true;
			this.modal = modal.toJSON();
		},
	});
	return { interaction, run: (i: any) => listener(i), state: () => readRelease(wire), restart, fetches };
}

test("message state round trips punctuation, Unicode, readiness and archive state within component limits", () => {
	const release = empty();
	release.closed = true;
	release.features = Array.from({ length: MAX_FEATURES }, (_, i) => ({
		id: `feature-${i}`,
		name: "🧀 [links](url) *bold* `code` \\ path @everyone",
		ready: i % 2 === 0,
	}));
	const rendered = renderRelease(release);
	expect(readRelease(JSON.parse(JSON.stringify(rendered.components)))).toEqual(release);
	const count = (c: any): number => 1 + (c.components ?? []).reduce((n: number, child: any) => n + count(child), 0) + (c.accessory ? count(c.accessory) : 0);
	expect(count(rendered.components[0])).toBeLessThanOrEqual(40);
	expect(rendered.allowedMentions).toEqual({ parse: [] });
	expect(() => renderRelease({ ...release, features: [...release.features, { id: "extra", name: "Extra", ready: false }] })).toThrow("hold up to");
});

test("creation is admin-only by default and confined to servers", () => {
	const command = data[0].toJSON();
	expect(command.default_member_permissions).toBe("8");
	expect(command.contexts).toEqual([0]);
});

test("add modal, restart, ready/unready, rename and edit/remove need only message state and no member permissions", async () => {
	const h = harness();
	const add = h.interaction("add");
	await h.run(add);
	expect(add.modal.custom_id).toBe(`${PREFIX}add-submit:123:`);
	await h.run(h.interaction("add-submit:123:", "modal", "New feature"));
	const id = h.state().features[0].id;
	h.restart();
	await h.run(h.interaction(`ready:${id}:0`));
	expect(h.state().features[0].ready).toBe(true);
	// Repeating a click from an old card is idempotent.
	await h.run(h.interaction(`ready:${id}:0`));
	expect(h.state().features[0].ready).toBe(true);
	await h.run(h.interaction(`ready:${id}:1`));
	expect(h.state().features[0].ready).toBe(false);
	const edit = h.interaction("edit:123", "select", "", [id]);
	await h.run(edit);
	expect(edit.modal.components[0].component.value).toBe("New feature");
	await h.run(h.interaction(`edit-submit:123:${id}`, "modal", "Updated feature"));
	await h.run(h.interaction("rename-submit:123:", "modal", "Next release"));
	expect(h.state().title).toBe("Next release");
	expect(h.state().features[0].name).toBe("Updated feature");
	await h.run(h.interaction("remove:123", "select", "", [id]));
	expect(h.state().features).toEqual([]);
	expect(h.fetches.every((f) => f.force === true)).toBe(true);
});

test("concurrent adds preserve both features and archiving rejects stale modal submissions until reopened", async () => {
	const h = harness();
	await Promise.all([h.run(h.interaction("add-submit:123:", "modal", "One")), h.run(h.interaction("add-submit:123:", "modal", "Two"))]);
	expect(h.state().features.map((f) => f.name)).toEqual(["One", "Two"]);
	await h.run(h.interaction("archive:123:1"));
	const stale = h.interaction("add-submit:123:", "modal", "Late feature");
	await h.run(stale);
	expect(stale.responses[0].content).toContain("archived");
	expect(h.state().features).toHaveLength(2);
	const manage = h.interaction("manage:1");
	await h.run(manage);
	expect(JSON.stringify(manage.responses)).toContain("Reopen release");
	await h.run(h.interaction("archive:123:0"));
	await h.run(h.interaction("add-submit:123:", "modal", "Late feature"));
	expect(h.state().features).toHaveLength(3);
});

test("capacity and invalid names leave the original card intact", async () => {
	const release = empty();
	release.features = Array.from({ length: MAX_FEATURES }, (_, i) => ({ id: String(i), name: `Feature ${i}`, ready: false }));
	const h = harness(release);
	const extra = h.interaction("add-submit:123:", "modal", "One too many");
	await h.run(extra);
	expect(extra.responses[0].content).toContain("hold up to");
	const blank = h.interaction("rename-submit:123:", "modal", "   ");
	await h.run(blank);
	expect(h.state()).toEqual(release);
});

test("a failed queued operation does not block later updates", async () => {
	const queue = createReleaseQueue();
	const first = queue("123", async () => {
		throw new Error("Network error");
	});
	const second = queue("123", async () => "recovered");
	await expect(first).rejects.toThrow("Network error");
	expect(await second).toBe("recovered");
});
