import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionRow, type ChatInputCommandInteraction, ComponentType, Embed, type Message, type MessageComponentInteraction } from "discord.js";
import { PluginUpdatesController } from "../src/PluginUpdates.ts";
import { type Artifact, type PluginDeployment } from "../src/utils/PluginDeployment.ts";
import { customId, pending, readState, renderState, selectArtifacts, type UpdateState } from "../src/utils/PluginUpdateMessage.ts";

const owner = "123456789012345678";
const artifacts: Artifact[] = Array.from({ length: 30 }, (_, index) => ({
	id: `Plugin${index}`,
	version: "2026.10.12",
	types: ["paper-plugin"],
	versions: ["2026.10.12"],
	filename: `Plugin${index}.jar`,
	url: "https://example.test/plugin.jar",
}));
const backend = { identifier: "abcdefgh", name: "Test server", description: "Lords of Minecraft" };
function state(): UpdateState {
	return { owner, server: { identifier: "abcdefgh", name: "Test server" }, stage: "select", page: 0, selected: [], completed: [] };
}

function message(initial: ReturnType<typeof renderState>) {
	const edits: ReturnType<typeof renderState>[] = [];
	const result = {
		id: "message",
		author: { id: "bot" },
		content: "",
		embeds: [] as Embed[],
		components: [] as ActionRow<any>[],
		async fetch() {
			return result as unknown as Message;
		},
		async edit(payload: ReturnType<typeof renderState>) {
			edits.push(payload);
			apply(payload);
			return result as unknown as Message;
		},
	};
	function apply(payload: ReturnType<typeof renderState>) {
		result.content = payload.content;
		if (payload.embeds) result.embeds = payload.embeds.map((embed) => new Embed(embed.toJSON()));
		result.components = payload.components.map((row) => new ActionRow(row.toJSON()));
	}
	apply(initial);
	return { result: result as unknown as Message, edits };
}

function click(target: Message, id: string, values: string[] = [], user = owner, memberPermissions: { has: () => boolean } | null = { has: () => true }) {
	const replies: any[] = [];
	const result = {
		customId: id,
		message: target,
		guildId: "391355330241757205",
		client: { user: { id: "bot" } },
		user: { id: user },
		memberPermissions,
		deferred: false,
		replied: false,
		values,
		isStringSelectMenu: () => id.endsWith(":artifacts") || id.endsWith(":server"),
		async deferUpdate() {
			result.deferred = true;
		},
		async reply(payload: any) {
			result.replied = true;
			replies.push(payload);
		},
		async followUp(payload: any) {
			replies.push(payload);
		},
	};
	return { interaction: result as unknown as MessageComponentInteraction, replies };
}

function command(guildId: string | null = "391355330241757205") {
	const replies: any[] = [];
	const edits: ReturnType<typeof renderState>[] = [];
	const result = {
		guildId,
		user: { id: owner },
		memberPermissions: { has: () => false },
		deferred: false,
		async deferReply() {
			result.deferred = true;
		},
		async reply(payload: any) {
			replies.push(payload);
		},
		async editReply(payload: ReturnType<typeof renderState>) {
			edits.push(payload);
		},
	};
	return { interaction: result as unknown as ChatInputCommandInteraction, replies, edits };
}

test("Discord-authorized delivered command accepts non-admin member permissions", async () => {
	const service = { servers: async () => [state().server!] } as unknown as PluginDeployment;
	const event = command();
	await new PluginUpdatesController(() => service).command(event.interaction);
	assert.equal(event.interaction.deferred, true);
	assert.deepEqual(event.replies, []);
	assert.deepEqual(readState(message(event.edits[0]).result), { owner, stage: "servers", page: 0, selected: [], completed: [] });
});

function assertResetControl(target: Message) {
	const controls = target.components.flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []));
	assert.ok(controls.some((component) => "customId" in component && component.customId?.endsWith(":reset")));
	assert.ok(!controls.some((component) => "customId" in component && component.customId?.endsWith(":cancel")));
}

for (const stage of ["servers", "select", "upload", "finished"] as const) {
	test(`reset returns ${stage} deployments to fresh server selection without deploying`, async () => {
		const selection = state();
		selection.stage = stage === "finished" ? "upload" : stage;
		selection.page = 1;
		selection.selected = ["Plugin0", "Plugin1"];
		selection.completed = [{ id: "Plugin0" }];
		if (stage === "finished") selection.completed.push({ id: "Plugin1" });
		const servers = Array.from({ length: 30 }, (_, index) => ({ identifier: `server${index}`, name: `Server ${index}` }));
		const target = message(renderState(selection, servers, artifacts));
		assertResetControl(target.result);
		let listings = 0;
		const service = {
			async servers() {
				listings++;
				return [{ identifier: "freshserver", name: "New server" }];
			},
			async deploy() {
				assert.fail("Reset must not upload releases");
			},
		} as unknown as PluginDeployment;
		const event = click(target.result, customId(selection, "reset"));
		await new PluginUpdatesController(() => service).component(event.interaction);
		assert.deepEqual(event.replies, []);
		assert.equal(listings, 1);
		assert.deepEqual(readState(target.result), { owner, stage: "servers", page: 0, selected: [], completed: [] });
		assert.match(JSON.stringify(target.result.components), /freshserver/);
		assertResetControl(target.result);
	});
}

for (const failure of ["empty", "error"]) {
	test(`reset preserves deployment progress when refreshed server lookup is ${failure}`, async () => {
		const selection = state();
		selection.stage = "upload";
		selection.selected = ["Plugin0", "Plugin1"];
		selection.completed = [{ id: "Plugin0" }];
		const target = message(renderState(selection));
		const service = {
			async servers() {
				if (failure === "error") throw new Error("Server listing unavailable");
				return [];
			},
		} as unknown as PluginDeployment;
		const event = click(target.result, customId(selection, "reset"));
		await new PluginUpdatesController(() => service).component(event.interaction);
		assert.match(event.replies[0].content, failure === "error" ? /Server listing unavailable/ : /No accessible servers/);
		assert.deepEqual(readState(target.result), selection);
		assert.equal(target.edits.length, 0);
	});
}

test("selection and completed uploads survive a message round trip without process state", () => {
	const original = state();
	original.selected = ["Plugin0", "Plugin27"];
	original.page = 1;
	original.completed = [{ id: "Plugin0" }];
	const restored = readState(message(renderState(original, [], artifacts)).result);
	assert.deepEqual(restored, original);
	assert.deepEqual(pending(restored), ["Plugin27"]);
});

test("retry migrates an existing deployment message and skips its recorded successes", async () => {
	const selection = state();
	selection.stage = "upload";
	selection.selected = ["Plugin0", "Plugin1"];
	const target = message(renderState(selection));
	target.result.embeds = [new Embed({
		...target.result.embeds[0].toJSON(),
		fields: [
			{ name: "Selected releases", value: "`Plugin0`\n`Plugin1`" },
			{ name: "Uploaded releases", value: "`Plugin0 old-release paper-plugin`" },
		],
	})];
	assert.deepEqual(pending(readState(target.result)), ["Plugin1"]);
	const deployed: string[] = [];
	const service = {
		async deploy(_server: string, id: string) {
			deployed.push(id);
			return artifacts[1];
		},
	} as unknown as PluginDeployment;
	const event = click(target.result, customId(selection, "retry"));
	await new PluginUpdatesController(() => service).component(event.interaction);
	assert.deepEqual(event.replies, []);
	assert.deepEqual(deployed, ["Plugin1"]);
	assert.deepEqual(pending(readState(target.result)), []);
	assert.deepEqual(target.result.embeds[0].fields, [{ name: "Releases", value: "✅ `Plugin0`\n✅ `Plugin1`" }]);
});

test("selections across pages use displayed artifact IDs when the catalog changes", () => {
	const selection = state();
	selectArtifacts(selection, ["Plugin0", "Plugin1"], ["Plugin1"]);
	selectArtifacts(selection, ["Plugin25", "Plugin26"], ["Plugin26"]);
	selectArtifacts(selection, ["Plugin0", "Plugin1"], []);
	assert.deepEqual(selection.selected, ["Plugin26"]);
	assert.throws(() => selectArtifacts(selection, ["Plugin0"], ["Unexpected"]), /does not match/);
});

test("a new controller continues an old message and preserves selections while paging", async () => {
	const selection = state();
	selection.selected = ["Plugin0"];
	const target = message(renderState(selection, [], artifacts));
	const service = { servers: async () => [backend], catalog: async () => ({ artifacts, failures: [] }) } as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(click(target.result, customId(selection, "next")).interaction);
	const restored = readState(target.result);
	assert.equal(restored.page, 1);
	assert.deepEqual(restored.selected, ["Plugin0"]);
	await new PluginUpdatesController(() => service).component(click(target.result, customId(restored, "artifacts"), ["Plugin28"]).interaction);
	assert.deepEqual(readState(target.result).selected, ["Plugin0", "Plugin28"]);
});

test("retry skips recorded successes and persists each new success before starting the next upload", async () => {
	const selection = state();
	selection.stage = "upload";
	selection.selected = ["Plugin0", "Plugin1", "Plugin2"];
	selection.completed = [{ id: "Plugin0" }];
	const target = message(renderState(selection));
	const deployed: string[] = [];
	const service = {
		async deploy(server: string, id: string) {
			assert.equal(server, "abcdefgh");
			if (id === "Plugin2") assert.ok(readState(target.result).completed.some((item) => item.id === "Plugin1"));
			deployed.push(id);
			return { ...artifacts.find((artifact) => artifact.id === id)!, version: "new-release" };
		},
	} as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(click(target.result, customId(selection, "retry")).interaction);
	assert.deepEqual(deployed, ["Plugin1", "Plugin2"]);
	assertResetControl(target.result);
	assert.ok(target.result.embeds[0].fields.some((field) => field.value.includes("✅ `Plugin1`")));
});

test("failed releases remain retryable after a new controller is created", async () => {
	const selection = state();
	selection.selected = ["Plugin0", "Plugin1"];
	const target = message(renderState(selection, [], artifacts));
	const first = {
		async deploy(_server: string, id: string) {
			if (id === "Plugin1") throw new Error("network failure");
			return artifacts[0];
		},
	} as unknown as PluginDeployment;
	const initialClick = click(target.result, customId(selection, "upload"));
	await new PluginUpdatesController(() => first).component(initialClick.interaction);
	const restored = readState(target.result);
	assert.deepEqual(pending(restored), ["Plugin1"]);
	assert.equal(initialClick.replies[0].flags, 64);
	const deployed: string[] = [];
	const second = {
		async deploy(_server: string, id: string) {
			deployed.push(id);
			return artifacts[1];
		},
	} as unknown as PluginDeployment;
	await new PluginUpdatesController(() => second).component(click(target.result, customId(restored, "retry")).interaction);
	assert.deepEqual(deployed, ["Plugin1"]);
});

test("retry after an upload but before recording success repeats that artifact", async () => {
	const selection = state();
	selection.stage = "upload";
	selection.selected = ["Plugin0"];
	const target = message(renderState(selection, [], [], "Uploading Plugin0…"));
	let calls = 0;
	const service = {
		async deploy() {
			calls++;
			return artifacts[0];
		},
	} as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(click(target.result, customId(selection, "retry")).interaction);
	assert.equal(calls, 1);
	assertResetControl(target.result);
});

test("failure to persist an upload stops the batch and the next controller retries the unrecorded upload", async () => {
	const selection = state();
	selection.selected = ["Plugin0", "Plugin1"];
	const target = message(renderState(selection, [], artifacts));
	const edit = target.result.edit.bind(target.result);
	let failSave = true;
	(target.result as any).edit = async (payload: ReturnType<typeof renderState>) => {
		if (failSave && payload.embeds[0].toJSON().fields?.some((field) => field.value.includes("✅ `Plugin0`"))) {
			failSave = false;
			throw new Error("Discord write failed");
		}
		return edit(payload);
	};
	const deployed: string[] = [];
	const service = {
		async deploy(_server: string, id: string) {
			deployed.push(id);
			return artifacts.find((artifact) => artifact.id === id)!;
		},
	} as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(click(target.result, customId(selection, "upload")).interaction);
	assert.deepEqual(deployed, ["Plugin0"]);
	const restored = readState(target.result);
	assert.deepEqual(pending(restored), ["Plugin0", "Plugin1"]);
	await new PluginUpdatesController(() => service).component(click(target.result, customId(restored, "retry")).interaction);
	assert.deepEqual(deployed, ["Plugin0", "Plugin0", "Plugin1"]);
});

test("unchanged controls remain usable when fetched message JSON has different property order", async () => {
	const selection = state();
	const clicked = message(renderState(selection, [], artifacts));
	const fetched = message(renderState(selection, [], artifacts));
	function reorder<Payload>(value: Payload): Payload {
		if (Array.isArray(value)) return value.map(reorder) as Payload;
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value)
					.reverse()
					.map(([key, item]) => [key, reorder(item)]),
			) as Payload;
		return value;
	}
	fetched.result.embeds = fetched.result.embeds.map((embed) => new Embed(reorder(embed.toJSON())));
	fetched.result.components = fetched.result.components.map((row) => new ActionRow(reorder(row.toJSON())));
	clicked.result.fetch = async () => fetched.result;
	const event = click(clicked.result, customId(selection, "next"));
	const service = { servers: async () => [backend], catalog: async () => ({ artifacts, failures: [] }) } as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(event.interaction);
	assert.deepEqual(event.replies, []);
	assert.equal(readState(fetched.result).page, 1);
});

for (const action of ["server", "reset"]) {
	test(`${action} accepts equivalent server controls with Discord metadata and explicit defaults`, async () => {
		const selection: UpdateState = { owner, stage: "servers", page: 0, selected: [], completed: [] };
		const servers = [{ identifier: "abcdefgh", name: "Buildteam" }];
		const clicked = message(renderState(selection, servers));
		const fetched = message(renderState(selection, servers));
		fetched.result.embeds = fetched.result.embeds.map((embed) => new Embed({ ...embed.toJSON(), type: "rich" }));
		fetched.result.components = fetched.result.components.map((row, index) => {
			const data = row.toJSON();
			return new ActionRow({
				...data,
				id: index + 1,
				components: data.components.map((component, componentIndex) => ({
					...component,
					id: index * 10 + componentIndex + 3,
					disabled: component.disabled ?? false,
					...(component.type === ComponentType.StringSelect
						? { options: component.options.map((option) => ({ ...option, default: option.default ?? false })) }
						: {}),
				})),
			});
		});
		clicked.result.fetch = async () => fetched.result;
		const event = click(clicked.result, customId(selection, action), ["abcdefgh"]);
		const service = {
			servers: async () => servers,
			catalog: async () => ({ artifacts, failures: [] }),
		} as unknown as PluginDeployment;
		await new PluginUpdatesController(() => service).component(event.interaction);
		assert.deepEqual(event.replies, []);
		if (action === "server") assert.equal(readState(fetched.result).server?.identifier, "abcdefgh");
		else assert.deepEqual(readState(fetched.result), selection);
	});
}

test("a stale click cannot overwrite a freshly changed message", async () => {
	const selection = state();
	const stale = message(renderState(selection, [], artifacts));
	const updated = message(renderState({ ...selection, selected: ["Plugin0"] }, [], artifacts));
	(stale.result as any).fetch = async () => updated.result;
	const event = click(stale.result, customId(selection, "artifacts"), ["Plugin1"]);
	await new PluginUpdatesController().component(event.interaction);
	assert.match(event.replies[0].content, /changed while you clicked/);
	assert.equal(updated.edits.length, 0);
});

for (const change of ["content", "route", "options", "disabled"]) {
	test(`a stale click is rejected when ${change} changes`, async () => {
		const selection = state();
		const clicked = message(renderState(selection, [], artifacts));
		const rendered = renderState(selection, [], change === "options" ? artifacts.slice(1) : artifacts);
		if (change === "content") rendered.content = "Deployment cancelled.";
		else if (change !== "options") {
			const button = rendered.components[1].components.find((component) => component.data.custom_id === customId(selection, "next"));
			assert.ok(button);
			if (change === "route") button.data.custom_id = customId({ ...selection, page: 1 }, "next");
			else button.data.disabled = true;
		}
		const fetched = message(rendered);
		clicked.result.fetch = async () => fetched.result;
		const event = click(clicked.result, customId(selection, "next"));
		await new PluginUpdatesController().component(event.interaction);
		assert.match(event.replies[0].content, /changed while you clicked/);
		assert.equal(fetched.edits.length, 0);
	});
}

test("a fetch that mutates cached embed fields still detects a stale click", async () => {
	const selection = state();
	selection.selected = ["Plugin0"];
	const target = message(renderState(selection, [], artifacts));
	target.result.fetch = async () => {
		target.result.embeds[0].fields[0].value = "`Plugin1`";
		return target.result;
	};
	const event = click(target.result, customId(selection, "next"));
	await new PluginUpdatesController().component(event.interaction);
	assert.match(event.replies[0].content, /changed while you clicked/);
	assert.equal(target.edits.length, 0);
});

test("message lock rejects concurrent retries and server lock rejects another message's upload", async () => {
	const selection = state();
	selection.selected = ["Plugin0"];
	const target = message(renderState(selection, [], artifacts));
	let release!: () => void;
	let started!: () => void;
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	const blocker = new Promise<void>((resolve) => {
		release = resolve;
	});
	const service = {
		async deploy() {
			started();
			await blocker;
			return artifacts[0];
		},
	} as unknown as PluginDeployment;
	const controller = new PluginUpdatesController(() => service);
	const uploading = controller.component(click(target.result, customId(selection, "upload")).interaction);
	await startedPromise;
	const retry = click(target.result, customId(readState(target.result), "retry"));
	await controller.component(retry.interaction);
	assert.match(retry.replies[0].content, /already being processed/);
	const reset = click(target.result, customId(readState(target.result), "reset"));
	await controller.component(reset.interaction);
	assert.match(reset.replies[0].content, /already being processed/);
	const other = message(renderState(selection, [], artifacts));
	other.result.id = "other-message";
	const otherClick = click(other.result, customId(selection, "upload"));
	await controller.component(otherClick.interaction);
	assert.match(otherClick.replies[0].content, /already running/);
	release();
	await uploading;
});

test("a fresh controller accepts persistent controls from the non-admin owner", async () => {
	const selection = state();
	const target = message(renderState(selection, [], artifacts));
	const service = { servers: async () => [backend], catalog: async () => ({ artifacts, failures: [] }) } as unknown as PluginDeployment;
	const event = click(target.result, customId(selection, "next"), [], owner, { has: () => false });
	await new PluginUpdatesController(() => service).component(event.interaction);
	assert.deepEqual(event.replies, []);
	assert.equal(event.interaction.deferred, true);
	assert.equal(readState(target.result).page, 1);
});

for (const guildId of ["foreign-guild", null]) {
	test(`command rejects guild ${guildId} before service creation or deferral`, async () => {
		const event = command(guildId);
		await new PluginUpdatesController(() => assert.fail("Denied command must not create the service")).command(event.interaction);
		assert.deepEqual(event.replies, [{ content: "This command is only available in the RAWBTV server.", flags: 64 }]);
		assert.equal(event.interaction.deferred, false);
		assert.deepEqual(event.edits, []);
	});
}

for (const denied of ["other non-admin", "other admin", "foreign guild", "forged author"]) {
	test(`persistent controls reject ${denied} before side effects`, async () => {
		const selection = state();
		selection.selected = ["Plugin0"];
		const target = message(renderState(selection, [], artifacts));
		const otherUser = denied.startsWith("other");
		const event = click(target.result, customId(selection, "upload"), [], otherUser ? "999999999999999999" : owner, {
			has: () => denied !== "other non-admin",
		});
		if (denied === "foreign guild") (event.interaction as any).guildId = "foreign-guild";
		if (denied === "forged author") (target.result.author as any).id = "not-the-bot";
		target.result.fetch = async () => assert.fail("Denied controls must not fetch the message");
		await new PluginUpdatesController(() => assert.fail("Denied controls must not create the service")).component(event.interaction);
		assert.deepEqual(event.replies, [{ content: "Only the user who started this deployment can use these controls in the RAWBTV server.", flags: 64 }]);
		assert.equal(event.interaction.deferred, false);
		assert.equal(target.edits.length, 0);
		assert.deepEqual(readState(target.result), selection);
	});
}

test("Discord component IDs and persisted embed fields stay within API limits", () => {
	const selection = state();
	// 250 IDs of 15 characters each exactly fill the 5,000-character reserved budget.
	selection.selected = Array.from({ length: 250 }, (_, index) => `PluginName${String(index).padStart(5, "0")}`);
	assert.deepEqual(readState(message(renderState(selection, [], artifacts)).result), selection);
	selection.completed = selection.selected.map((id) => ({ id }));
	const rendered = renderState(selection, [], artifacts);
	const embed = rendered.embeds[0].toJSON();
	assert.ok(embed.fields!.every((field) => field.value.length <= 1024));
	assert.ok(embed.fields!.length <= 25);
	assert.ok(rendered.embeds[0].length <= 6000);
	for (const row of rendered.components)
		for (const component of row.toJSON().components) {
			if ("custom_id" in component) assert.ok(component.custom_id!.length <= 100);
		}
	assert.deepEqual(readState(message(rendered).result), selection);
	assert.throws(
		() => renderState({ ...selection, selected: [...selection.selected, "OneMore"] }, [], artifacts),
		/separate batches/,
	);
});

test("the release menu only offers releases compatible with the selected server", async () => {
	const mixed: Artifact[] = [
		{ ...artifacts[0], id: "PaperPlugin", types: ["paper-plugin"] },
		{ ...artifacts[0], id: "IgniteMod", types: ["ignite-mod"] },
		{ ...artifacts[0], id: "VelocityPlugin", types: ["velocity-plugin"] },
		{ ...artifacts[0], id: "BothPlugin", types: ["paper-plugin", "velocity-plugin"] },
	];
	for (const [description, expected] of [
		["Lords of Minecraft", ["PaperPlugin", "IgniteMod", "BothPlugin"]],
		["Lords of Minecraft Proxy", ["VelocityPlugin", "BothPlugin"]],
	] as const) {
		const target = message(renderState(state()));
		const service = {
			servers: async () => [{ ...backend, description }],
			catalog: async () => ({ artifacts: mixed, failures: [] }),
		} as unknown as PluginDeployment;
		const event = click(target.result, customId(state(), "next"));
		await new PluginUpdatesController(() => service).component(event.interaction);
		assert.deepEqual(event.replies, []);
		const menu = target.edits.at(-1)!.components[0].toJSON() as any;
		assert.deepEqual(
			menu.components[0].options.map((option: { value: string }) => option.value),
			expected,
		);
	}
});
