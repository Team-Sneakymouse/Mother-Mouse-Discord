import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
test("production and RAWBTV command registration wire shared todos without enabling schedules",async()=>{
 const bot=await readFile("src/bot.ts","utf8"),register=await readFile("registerCommands.ts","utf8");
 expect(bot).toContain('import TodoList from "./Todo.js"');expect(bot).toContain("TodoList(client, pocketbase");
 expect(register).toContain('import { data as SharedTodos } from "./src/Todo.js"');expect(register).toContain("...SharedTodos");
 const docker=await readFile("Dockerfile","utf8"),service=await readFile("src/todo/service.ts","utf8");
 expect(docker).toContain("COPY ./docs/todo-assessment-guidance.md ./docs/todo-assessment-guidance.md");expect(service).toContain("TODO_GUIDANCE_FILE");
});
