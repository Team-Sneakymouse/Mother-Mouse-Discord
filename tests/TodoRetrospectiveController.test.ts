import { expect, test } from "bun:test";
import { TodoController, data } from "../src/Todo.js";
import { renderRetrospective } from "../src/todo/retrospective.js";
test("retrospective slash and owned bot controls require displayed hash, guild and actual developer", async () => {
	expect(data[0].toJSON().options?.some((o) => o.name === "retrospective")).toBe(true);
	const calls: any[] = [];
	const status = { run_id: "run", thread_id: "thread", state: "proposed", proposal_hash: "a".repeat(64), diff: "+ Lesson" };
	const controller = new TodoController(
		{} as any,
		{
			open: async (...a: any[]) => {
				calls.push(["open", ...a]);
				return status;
			},
			approve: async (...a: any[]) => {
				calls.push(["approve", ...a]);
				return { ...status, state: "applied" };
			},
		} as any,
	);
	const view = renderRetrospective(status, "123");
	const make = (author = "bot", user = "123") =>
		({
			guildId: "391355330241757205",
			user: { id: user },
			client: { user: { id: "bot" } },
			customId: "todo-retro|123|approve|run",
			message: { author: { id: author }, embeds: view.embeds },
			reply: async () => {},
			deferUpdate: async () => {},
			editReply: async () => {},
		}) as any;
	await controller.component(make("forged"));
	await controller.component(make("bot", "other"));
	expect(calls).toHaveLength(0);
	const foreign = make();
	foreign.guildId = "foreign";
	await controller.component(foreign);
	expect(calls).toHaveLength(0);
	const mismatch = make();
	mismatch.message.embeds = [{ footer: { text: 'todo-retro:{"owner":"123","id":"another","hash":"' + "a".repeat(64) + '"}' } }];
	await controller.component(mismatch);
	expect(calls).toHaveLength(0);
	await controller.component(make());
	expect(calls[0]).toEqual(["approve", "391355330241757205", "123", "run", "a".repeat(64)]);
});
test("retrospective slash acknowledges before opening the full-agent workflow", async () => {
	const events: string[] = [];
	const controller = new TodoController(
		{} as any,
		{
			open: async (g: string, u: string) => {
				events.push(`open:${g}:${u}`);
				return { state: "empty" };
			},
		} as any,
	);
	await controller.command({
		guildId: "391355330241757205",
		user: { id: "123" },
		options: { getSubcommand: () => "retrospective" },
		deferReply: async () => events.push("ack"),
		editReply: async () => events.push("render"),
	} as any);
	expect(events).toEqual(["ack", "open:391355330241757205:123", "render"]);
});
