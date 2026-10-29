import { expect, test } from "bun:test";
import { TodoRetrospective } from "../src/todo/retrospective.js";
test("first dispatch durably reserves creation, persists thread before admission and freezes returned baseline", async () => {
	const calls: any[] = [];
	let run: any = { id: "run", guild_id: "guild", actor: "123", state: "investigating" };
	const repo = {
		operation: async (a: string, b: any) => {
			calls.push([a, b]);
			if (a === "retrospective-begin") return { run, corrections: [{ id: "c" }], reports: [], labels: [] };
			if (a === "retrospective-stage") {
				run = { ...run, ...b };
				return run;
			}
			return run;
		},
	};
	let starts = 0;
	const bridge = {
		preflightRetrospective: async () => {},
		ready: async () => {},
		startRetrospective: async (input: any) => {
			starts++;
			expect(calls.at(-1)[1].dispatch_token).toMatch(/^[a-f0-9]{32}$/);
			await input.onThread("456");
			expect(run.thread_id).toBe("456");
			return { status: "accepted", run_id: "run", thread_id: "456", baseline_version: "2", baseline_hash: "a".repeat(64) };
		},
		status: async () => ({ run_id: "run", thread_id: "456", state: "investigating", baseline_version: "2", baseline_hash: "a".repeat(64) }),
	};
	const service = new TodoRetrospective(repo as any, bridge as any);
	await service.open("guild", "123");
	await service.open("guild", "123");
	expect(starts).toBe(1);
	expect(run.baseline_hash).toBe("a".repeat(64));
	expect(calls.filter((c) => c[0] === "retrospective-stage")).toHaveLength(3);
});
test("uncertain forum creation reservation never creates a replacement thread", async () => {
	let starts = 0;
	const run = { id: "run", guild_id: "guild", actor: "123", state: "investigating", dispatch_token: "d".repeat(32) };
	const repo = { operation: async () => ({ run, corrections: [], reports: [], labels: [] }) };
	const bridge = {
		preflightRetrospective: async () => {},
		ready: async () => {},
		startRetrospective: async () => {
			starts++;
		},
	};
	await expect(new TodoRetrospective(repo as any, bridge as any).open("guild", "123")).rejects.toThrow("uncertain");
	expect(starts).toBe(0);
});
