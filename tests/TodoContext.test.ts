import { expect, test } from "bun:test";
import { collectContext } from "../src/todo/context.js";

const msg = (id: string, sender: string, time: number, reply?: string) => ({ id, channelId: "c", senderId: sender, senderName: sender, timestamp: time, content: id, attachments: [], replyTo: reply });
test("report context recursively follows uncached replies and same sender windows over all history pages", async () => {
 const history = [msg("6", "d", 300000, "5"), msg("5", "c", 200000, "4"), msg("4", "c", 175000), msg("3", "b", 100000, "2"), msg("2", "a", 50000), msg("1", "a", 25000)];
 const calls: (string | undefined)[] = [];
 const result = await collectContext(history[4], async (before) => { calls.push(before); const start = before ? history.findIndex(m => m.id === before) + 1 : 0; return history.slice(start, start + 2); }, { pageSize: 2 });
 expect(calls).toEqual([undefined, "5", "3", "1"]);
 expect(result.messages.map(m => m.id)).toEqual(["1", "2", "3"]);
 expect(result.complete).toBe(true);
 expect(result.text).toContain("a [1]");
});
test("context expands recursively on both directions and every sender window", async () => {
 const history = [msg("5", "c", 220000, "4"), msg("4", "c", 195000, "3"), msg("3", "b", 100000, "2"), msg("2", "a", 50000), msg("1", "a", 25000)];
 const result = await collectContext(history[2], async () => history);
 expect(result.messages.map(m => m.id)).toEqual(["1","2","3","4","5"]);
});
test("pagination errors, missing replies and safety bounds are explicit; other channels excluded", async () => {
 const original = msg("2", "a", 50000, "missing");
 const result = await collectContext(original, async () => [msg("1", "a", 25000), {...msg("0", "a", 0), channelId:"foreign"}], {pageSize:2,maxPages:1,maxIncluded:1});
 expect(result.complete).toBe(false);
 expect(result.errors).toEqual(expect.arrayContaining(["history_safety_bound","missing_reply:missing","context_safety_bound"]));
 expect(result.messages).toEqual([original]);
 const failure = await collectContext(original, async () => { throw new Error("denied"); });
 expect(failure.errors).toContain("history_fetch_failed");
});
