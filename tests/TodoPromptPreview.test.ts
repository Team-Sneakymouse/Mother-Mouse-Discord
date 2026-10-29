import { expect, test } from "bun:test";
import { MessageFlags } from "discord.js";
import { TodoController } from "../src/Todo.js";
import { renderList } from "../src/todo/list.js";
import { openingPrompt, TodoService } from "../src/todo/service.js";
const guild = "391355330241757205";
const todo: any = {
	id: "t",
	number: 42,
	guild_id: guild,
	label: "l",
	kind: "bug",
	priority: "blue",
	status: "open",
	title: "Task",
	description: "Fix",
	audit: [],
};
const label: any = { id: "l", guild_id: guild, name: "Plugin", repo: "https://github.com/Team/Plugin" };
const report: any = {
	id: "r",
	guild_id: guild,
	channel_id: "456",
	message_id: "789",
	todos: ["t"],
	source: { content: "@everyone" },
	context: { complete: true, errors: [] },
	context_text: "evidence",
};
function interaction(overrides: any = {}) {
	const sent: any[] = [];
	const rendered = renderList([todo], [label], { owner: "123", page: 0, filters: {} });
	const i: any = {
		guildId: guild,
		user: { id: "123" },
		customId: "todo|123|prompt|t",
		client: { user: { id: "bot" } },
		message: { author: { id: "bot" }, embeds: rendered.embeds },
		sent,
		deferred: false,
		replied: false,
		reply: async (p: any) => {
			sent.push({ method: "reply", ...p });
			i.replied = true;
		},
		deferReply: async (p: any) => {
			sent.push({ method: "defer", ...p });
			i.deferred = true;
		},
		editReply: async (p: any) => sent.push({ method: "edit", ...p }),
		followUp: async (p: any) => sent.push({ method: "follow", ...p }),
		deferUpdate: async () => {
			throw new Error("List must not be updated");
		},
		...overrides,
	};
	return i;
}
test("Show prompt replies privately with the exact full Unicode opening prompt without writes or launch", async () => {
	const longReport = { ...report, context_text: "😀 evidence\n".repeat(800) };
	const reads: string[] = [];
	const repo: any = {
		todo: async (id: string) => {
			reads.push(id);
			return todo;
		},
		label: async () => label,
		reportsFor: async () => [longReport],
		operation: async () => {
			throw new Error("No writes");
		},
	};
	const service = new TodoService(repo, undefined, {
		ready: async () => {
			throw new Error("No Hermes");
		},
		start: async () => {
			throw new Error("No thread");
		},
	});
	const i = interaction();
	const before = JSON.stringify(i.message);
	await new TodoController(service).component(i);
	expect(i.sent[0]).toMatchObject({ method: "defer", flags: MessageFlags.Ephemeral });
	const messages = i.sent.filter((p: any) => p.content);
	expect(messages.length).toBeGreaterThan(1);
	expect(messages.map((p: any) => p.content).join("")).toBe(openingPrompt(todo, label, [longReport]));
	expect(reads).toEqual(["t"]);
	expect(JSON.stringify(i.message)).toBe(before);
	for (const p of messages) {
		expect(p.content.length).toBeLessThanOrEqual(2000);
		expect(p.allowedMentions).toEqual({ parse: [], repliedUser: false });
		expect(p.content.isWellFormed()).toBe(true);
		if (p.method === "follow") expect(p.flags).toBe(MessageFlags.Ephemeral);
	}
});
test("failed prompt continuation preserves the first chunk and reports incomplete delivery privately", async () => {
	const i = interaction();
	let follows = 0;
	i.followUp = async (p: any) => {
		if (++follows === 1) throw new Error("Discord unavailable");
		i.sent.push({ method: "follow", ...p });
	};
	await new TodoController({ previewPrompt: async () => "x".repeat(5000) } as any).component(i);
	expect(i.sent.filter((p: any) => p.method === "edit")).toHaveLength(1);
	expect(i.sent.find((p: any) => p.method === "edit").content).toBe("x".repeat(2000));
	expect(i.sent.at(-1)).toMatchObject({ method: "follow", flags: MessageFlags.Ephemeral });
	expect(i.sent.at(-1).content).toContain("incomplete");
});
test("Show prompt rejects foreign users, authors and guilds before reading context", async () => {
	let reads = 0;
	const controller = new TodoController({
		previewPrompt: async () => {
			reads++;
			return "secret";
		},
	} as any);
	for (const overrides of [{ user: { id: "other" } }, { message: { author: { id: "forged" } } }, { guildId: "foreign" }]) {
		const i = interaction(overrides);
		await controller.component(i);
		expect(i.sent[0]).toMatchObject({ method: "reply", flags: MessageFlags.Ephemeral });
		expect(i.sent[0].content).toContain("Only");
	}
	expect(reads).toBe(0);
});
test("Show prompt scopes context errors to its private reply without replacing the list", async () => {
	for (const foreign of ["todo", "label", "report", "failure"]) {
		const repo: any = {
			todo: async () => {
				if (foreign === "failure") throw new Error("Read failed");
				return { ...todo, guild_id: foreign === "todo" ? "foreign" : guild };
			},
			label: async () => ({ ...label, guild_id: foreign === "label" ? "foreign" : guild }),
			reportsFor: async () => [{ ...report, guild_id: foreign === "report" ? "foreign" : guild }],
		};
		const i = interaction();
		await new TodoController(new TodoService(repo)).component(i);
		expect(i.sent[0]).toMatchObject({ method: "defer", flags: MessageFlags.Ephemeral });
		expect(i.sent[1].method).toBe("edit");
		expect(i.sent[1].content).toContain(foreign === "failure" ? "Read failed" : "outside this server");
		expect(i.sent[1].embeds).toBeUndefined();
	}
});
test("Show prompt is next to Start and remains available on claimed tasks", () => {
	for (const task of [todo, { ...todo, status: "in_progress", claim: { token: "claimed" } }]) {
		const row = renderList([task], [label], { owner: "123", page: 0, filters: {} }).components[0].components;
		expect(row.map((c) => c.label)).toEqual(task.status === "open" ? ["Start", "Show prompt", "Edit"] : ["Show prompt", "Edit"]);
		expect(row.find((c) => c.label === "Show prompt")?.custom_id).toBe("todo|123|prompt|t");
	}
});
