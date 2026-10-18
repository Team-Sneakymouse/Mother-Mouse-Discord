import { expect, test } from "bun:test";
import ReleaseChecklist, { data } from "../src/ReleaseChecklist/index.js";
import { MAX_FEATURES, PREFIX, readRelease, renderRelease, type Release } from "../src/ReleaseChecklist/card.js";

const empty = (): Release => ({ title: "Weekly *release* \\ #1", closed: false, features: [] });

function harness(initial = empty()) {
	let listener: (interaction: any) => Promise<void>;
	let wire = renderRelease(initial).components;
	const messageEdits: any[] = [];
	const message = {
		id: "123",
		author: { id: "bot" },
		get components() {
			return wire.map((c) => ({ toJSON: () => c }));
		},
		async edit(payload: ReturnType<typeof renderRelease>) {
			messageEdits.push(payload);
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
		// Discord supplies a snapshot; management interactions originate on a separate private message.
		message: { ...message, id: /^(add(?:-submit)?(?::|$)|manage:|ready:)/.test(customId) ? "123" : "456" },
		values,
		deferred: false,
		replied: false,
		acknowledgement: "",
		acknowledgementGate: Promise.resolve(),
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
		isFromMessage: () => kind === "modal",
		responses: [] as any[],
		modal: undefined as any,
		async reply(payload: any) {
			this.replied = true;
			this.responses.push(payload);
		},
		async deferReply() {
			await this.acknowledgementGate;
			this.deferred = true;
			this.acknowledgement = "reply";
		},
		async deferUpdate() {
			await this.acknowledgementGate;
			this.deferred = true;
			this.acknowledgement = "update";
		},
		async editReply(payload: any) {
			if (payload.components?.[0]?.type === 17) wire = payload.components;
			this.responses.push(payload);
		},
		async update(payload: any) {
			this.replied = true;
			this.acknowledgement = "direct";
			if (payload.components?.[0]?.type === 17) wire = payload.components;
			this.responses.push(payload);
		},
		async followUp(payload: any) {
			this.responses.push(payload);
		},
		async showModal(modal: any) {
			this.replied = true;
			this.modal = modal.toJSON();
		},
	});
	return { interaction, run: (i: any) => listener(i), state: () => readRelease(wire), restart, fetches, messageEdits };
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

test("a slow Discord acknowledgement does not delay the independent message fetch", async () => {
	const h = harness();
	const interaction = h.interaction("archive:123:1");
	let release!: () => void;
	interaction.acknowledgementGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const running = h.run(interaction);
	try {
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(h.fetches).toHaveLength(1);
	} finally {
		release();
		await running;
	}
});

test("opening Add and Manage uses the card already supplied by Discord without another fetch", async () => {
	const h = harness();
	await h.run(h.interaction("add"));
	await h.run(h.interaction("manage:0"));
	expect(h.fetches).toHaveLength(0);
});

test("a fetch failure waits for the in-flight acknowledgement before sending an error follow-up", async () => {
	const h = harness();
	const interaction = h.interaction("archive:123:1");
	let release!: () => void;
	interaction.acknowledgementGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	interaction.channel.messages.fetch = async () => {
		throw new Error("Fetch failed");
	};
	const running = h.run(interaction);
	try {
		for (let i = 0; i < 10; i++) await Promise.resolve();
		expect(interaction.responses).toHaveLength(0);
	} finally {
		release();
		await running;
	}
	expect(interaction.replied).toBe(false);
	expect(interaction.responses[0].content).toBe("Fetch failed");
	expect(h.state().closed).toBe(false);
});

test("active card color follows readiness, with empty cards yellow and archived cards gray", () => {
	const release = empty();
	const color = () => renderRelease(release).components[0].accent_color;
	expect(color()).toBe(0xf1c40f);
	release.features.push({ id: "one", name: "One", ready: false }, { id: "two", name: "Two", ready: true });
	expect(color()).toBe(0xf1c40f);
	release.features[0].ready = true;
	expect(color()).toBe(0x2ecc71);
	release.features[1].ready = false;
	expect(color()).toBe(0xf1c40f);
	release.features[1].ready = true;
	release.closed = true;
	expect(color()).toBe(0x808080);
});

test("management actions update the originating private panel, including modal edits and archive controls", async () => {
	const h = harness({
		...empty(),
		features: [
			{ id: "one", name: "One", ready: false },
			{ id: "two", name: "Two", ready: true },
		],
	});
	const edit = h.interaction("edit-submit:123:one", "modal", "Renamed feature");
	await h.run(edit);
	expect(edit.acknowledgement).toBe("update");
	expect(JSON.stringify(edit.responses[0])).toContain("Renamed feature");
	const rename = h.interaction("rename-submit:123:", "modal", "Renamed release");
	await h.run(rename);
	expect(rename.acknowledgement).toBe("update");
	expect(rename.responses[0].content).toContain("Renamed release");
	const remove = h.interaction("remove:123", "select", "", ["one"]);
	await h.run(remove);
	expect(remove.acknowledgement).toBe("update");
	expect(remove.responses[0].components[0].toJSON().components[0].options.map((o: any) => o.value)).toEqual(["two"]);
	const archive = h.interaction("archive:123:1");
	await h.run(archive);
	expect(archive.acknowledgement).toBe("update");
	expect(archive.responses[0].components).toHaveLength(1);
	expect(JSON.stringify(archive.responses[0])).toContain("Reopen release");
	const reopen = h.interaction("archive:123:0");
	await h.run(reopen);
	expect(reopen.acknowledgement).toBe("update");
	expect(reopen.responses[0].components).toHaveLength(3);
	expect(JSON.stringify(reopen.responses[0])).toContain("Archive release");
	const add = h.interaction("add-submit:123:", "modal", "Third feature");
	await h.run(add);
	expect(add.acknowledgement).toBe("direct");
	expect(add.responses[0].components[0].type).toBe(17);
});

test("ready and add submissions use one public-card response instead of separate card and confirmation edits", async () => {
	const h = harness();
	const add = h.interaction("add-submit:123:", "modal", "First feature");
	await h.run(add);
	const id = h.state().features[0].id;
	const ready = h.interaction(`ready:${id}:0`);
	await h.run(ready);
	expect(ready.acknowledgement).toBe("direct");
	expect(h.state().features[0].ready).toBe(true);
	expect(h.messageEdits).toHaveLength(0);
	expect(h.fetches).toHaveLength(0);
	expect(add.responses).toHaveLength(1);
	expect(ready.responses).toHaveLength(1);
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
	expect(h.fetches.every((f) => f.message === "123" && f.force !== true)).toBe(true);
});

test("sequential adds preserve features and archived snapshots reject changes until reopened", async () => {
	const h = harness();
	await h.run(h.interaction("add-submit:123:", "modal", "One"));
	await h.run(h.interaction("add-submit:123:", "modal", "Two"));
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
