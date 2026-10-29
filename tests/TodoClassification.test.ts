import { expect, test } from "bun:test";
import { TodoController, data } from "../src/Todo.js";
import { renderDetail } from "../src/todo/detail.js";
test("kind and priority are revision-fenced manual classification commands and visible selectors", async () => {
	for (const field of ["kind", "priority"]) {
		expect(data[0].toJSON().options?.some((o) => o.name === field)).toBe(true);
		const calls: any[] = [];
		const controller = new TodoController({
			repo: {
				byNumber: async () => ({ id: "t", audit: [{}] }),
				operation: async (a: string, b: any) => {
					calls.push({ a, ...b });
					return { number: 1 };
				},
			},
		} as any);
		const sent: any[] = [];
		await controller.command({
			guildId: "391355330241757205",
			user: { id: "123" },
			options: {
				getSubcommand: () => field,
				getInteger: () => 1,
				getString: (k: string) => (k === field ? (field === "kind" ? "feature" : "red") : "intentional override"),
			},
			deferReply: async () => {},
			editReply: async (p: any) => sent.push(p),
		} as any);
		expect(calls[0]).toMatchObject({
			a: "classification",
			[field]: field === "kind" ? "feature" : "red",
			actor: "123",
			expected_revision: 1,
			reason: "intentional override",
		});
	}
	const view = renderDetail(
		{ id: "t", number: 1, title: "Task", description: "Task", kind: "feature", priority: "blue", status: "open", label: "l" } as any,
		[{ id: "l", name: "Label" }],
		{ owner: "123", page: 0, filters: {} },
	);
	expect(view.components).toHaveLength(5);
	for (const field of ["kind", "priority"]) expect(view.components.some((r) => r.components[0].custom_id.includes(`set-${field}`))).toBe(true);
});
