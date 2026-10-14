import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionRow, ComponentType, Embed, type Message, type MessageComponentInteraction } from "discord.js";
import { PluginUpdatesController } from "../src/PluginUpdates.ts";
import { type Artifact, type PluginDeployment } from "../src/utils/PluginDeployment.ts";
import { customId, pending, readState, renderState, selectArtifacts, type UpdateState } from "../src/utils/PluginUpdateMessage.ts";

const owner = "123456789012345678";
const artifacts: Artifact[] = Array.from({ length: 30 }, (_, index) => ({
	id: `Plugin${index}`,
	version: "2026.10.12",
	type: "paper-plugin",
	versions: ["2026.10.12"],
	filename: `Plugin${index}.jar`,
	url: "https://example.test/plugin.jar",
}));
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
		result.embeds = payload.embeds.map((embed) => new Embed(embed.toJSON()));
		result.components = payload.components.map((row) => new ActionRow(row.toJSON()));
	}
	apply(initial);
	return { result: result as unknown as Message, edits };
}

function click(target: Message, id: string, values: string[] = [], user = owner) {
	const replies: any[] = [];
	const result = {
		customId: id,
		message: target,
		guildId: "391355330241757205",
		client: { user: { id: "bot" } },
		user: { id: user },
		memberPermissions: { has: () => true },
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

test("selection and completed uploads survive a message round trip without process state", () => {
	const original = state();
	original.selected = ["Plugin0", "Plugin27"];
	original.page = 1;
	original.completed = [{ id: "Plugin0", version: "2026.10.11", type: "paper-plugin" }];
	const restored = readState(message(renderState(original, [], artifacts)).result);
	assert.deepEqual(restored, original);
	assert.deepEqual(pending(restored), ["Plugin27"]);
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
	const service = { catalog: async () => ({ artifacts, failures: [] }) } as unknown as PluginDeployment;
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
	selection.completed = [{ id: "Plugin0", version: "old-release", type: "paper-plugin" }];
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
	assert.equal(target.result.components.length, 0);
	assert.ok(target.result.embeds[0].fields.some((field) => field.value.includes("Plugin1 new-release")));
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
	assert.equal(target.result.components.length, 0);
});

test("failure to persist an upload stops the batch and the next controller retries the unrecorded upload", async () => {
	const selection = state();
	selection.selected = ["Plugin0", "Plugin1"];
	const target = message(renderState(selection, [], artifacts));
	const edit = target.result.edit.bind(target.result);
	let failSave = true;
	(target.result as any).edit = async (payload: ReturnType<typeof renderState>) => {
		if (failSave && payload.embeds[0].toJSON().fields?.some((field) => field.name === "Uploaded releases")) {
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
	const service = { catalog: async () => ({ artifacts, failures: [] }) } as unknown as PluginDeployment;
	await new PluginUpdatesController(() => service).component(event.interaction);
	assert.deepEqual(event.replies, []);
	assert.equal(readState(fetched.result).page, 1);
});

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
	const other = message(renderState(selection, [], artifacts));
	other.result.id = "other-message";
	const otherClick = click(other.result, customId(selection, "upload"));
	await controller.component(otherClick.interaction);
	assert.match(otherClick.replies[0].content, /already running/);
	release();
	await uploading;
});

test("only the initiating administrator may use a persistent message", async () => {
	const selection = state();
	const target = message(renderState(selection, [], artifacts));
	const outsider = click(target.result, customId(selection, "next"), [], "999999999999999999");
	await new PluginUpdatesController().component(outsider.interaction);
	assert.match(outsider.replies[0].content, /who started/);
	assert.equal(target.edits.length, 0);
});

test("Discord component IDs and persisted embed fields stay within API limits", () => {
	const selection = state();
	selection.selected = artifacts.slice(0, 20).map((artifact) => artifact.id);
	selection.completed = selection.selected.map((id) => ({ id, version: "x".repeat(100), type: "paper-plugin" }));
	const rendered = renderState(selection, [], artifacts);
	const embed = rendered.embeds[0].toJSON();
	assert.ok(embed.fields!.every((field) => field.value.length <= 1024));
	assert.ok(rendered.embeds[0].length <= 6000);
	for (const row of rendered.components)
		for (const component of row.toJSON().components) {
			if ("custom_id" in component) assert.ok(component.custom_id!.length <= 100);
		}
	assert.deepEqual(readState(message(rendered).result), selection);
	assert.throws(
		() => renderState({ ...selection, selected: Array.from({ length: 100 }, (_, index) => `LongPluginName${index}`) }, [], artifacts),
		/separate batches/,
	);
});
