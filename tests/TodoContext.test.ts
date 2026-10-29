import { expect, test } from "bun:test";
import { collectContext, type ContextMessage } from "../src/todo/context.js";

test("dense history and a long reply chain use bounded work and yield to other interactions", async () => {
	let reads = 0;
	let ticks = 0;
	let firstTickReads = 0;
	let finished = false;
	const heartbeat = () => {
		if (finished) return;
		ticks++;
		if (ticks === 1) firstTickReads = reads;
		setImmediate(heartbeat);
	};
	const measured = (message: ContextMessage): ContextMessage =>
		new Proxy(message, {
			get(target, property, receiver) {
				if (["id", "senderId", "timestamp", "replyTo"].includes(String(property))) {
					reads++;
					if (reads > 1_000_000) throw new Error("context work exceeded linearithmic accessor budget");
				}
				return Reflect.get(target, property, receiver);
			},
		});
	const history: ContextMessage[] = [];
	// Dense sender windows must not create every pair as an edge.
	for (let i = 0; i < 2000; i++) history.push(measured(msg(`dense-${i}`, "dense", i, i === 0 ? "chain-1999" : undefined)));
	// Unique senders force traversal to follow the entire long reply chain.
	for (let i = 0; i < 2000; i++) history.push(measured(msg(`chain-${i}`, `sender-${i}`, 100000 + i, i ? `chain-${i - 1}` : undefined)));
	for (let i = 0; i < 2000; i++) history.push(measured(msg(`unrelated-${i}`, `other-${i}`, 200000 + i)));
	setImmediate(heartbeat);
	try {
		const result = await collectContext(history[2000], async () => history, { pageSize: 10000 });
		expect(result.complete).toBe(true);
		expect(result.messages).toHaveLength(4000);
		expect(new Set(result.messages.map((m) => m.id)).size).toBe(4000);
		expect(reads).toBeLessThan(1_000_000);
		expect(ticks).toBeGreaterThan(2);
		expect(firstTickReads).toBeLessThan(reads);
	} finally {
		finished = true;
	}
});

const msg = (id: string, sender: string, time: number, reply?: string) => ({
	id,
	channelId: "c",
	senderId: sender,
	senderName: sender,
	timestamp: time,
	content: id,
	attachments: [],
	replyTo: reply,
});
test("history message safety bound caps oversized pages without claiming completeness", async () => {
	const original = msg("seed", "a", 0);
	const result = await collectContext(original, async () => [msg("1", "a", 1), msg("2", "a", 2), msg("3", "a", 3)], { maxMessages: 2 });
	expect(result.scanned).toBe(2);
	expect(result.messages).toHaveLength(2);
	expect(result.complete).toBe(false);
	expect(result.errors).toContain("history_safety_bound");
});

test("an unfetched seed preserves inclusive transitive sender windows, numeric ties and speaker text", async () => {
	const original: ContextMessage = { ...msg("10", "a", 30000), content: "selected", attachments: [{ name: null, url: "https://example.test/file" }] };
	const history = [
		msg("20", "a", 90000),
		msg("2", "a", 30000),
		msg("1", "a", 0),
		msg("15", "a", 60000),
		msg("outside", "a", 120001),
		{ ...msg("foreign", "a", 30000, "10"), channelId: "elsewhere" },
	];
	const result = await collectContext(original, async () => history);
	expect(result.messages.map((m) => m.id)).toEqual(["1", "2", "10", "15", "20"]);
	expect(result.complete).toBe(true);
	expect(result.text).toContain("### a [10] — 1970-01-01T00:00:30.000Z\nselected\nAttachment: file https://example.test/file");
});

test("indexed closure matches exhaustive reply and sender windows across cyclic histories", async () => {
	const history = Array.from({ length: 48 }, (_, i) => msg(String(i), `speaker-${i % 7}`, ((i * 17) % 48) * 10000, i % 3 ? String((i + 11) % 48) : undefined));
	for (const original of history) {
		const expected = new Map([[original.id, original]]);
		const queue = [original];
		for (let i = 0; i < queue.length; i++) {
			for (const candidate of history) {
				if (
					!expected.has(candidate.id) &&
					(candidate.id === queue[i].replyTo ||
						candidate.replyTo === queue[i].id ||
						(candidate.senderId === queue[i].senderId && Math.abs(candidate.timestamp - queue[i].timestamp) <= 30000))
				) {
					expected.set(candidate.id, candidate);
					queue.push(candidate);
				}
			}
		}
		const result = await collectContext(original, async () => history);
		expect(result.messages.map((m) => m.id)).toEqual(
			[...expected.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, undefined, { numeric: true })).map((m) => m.id),
		);
		expect(result.complete).toBe(true);
	}
});

test("repeated pagination cursors report incompleteness without looping", async () => {
	let calls = 0;
	const original = msg("1", "a", 0);
	const result = await collectContext(
		original,
		async () => {
			calls++;
			return [original];
		},
		{ pageSize: 1 },
	);
	expect(calls).toBe(2);
	expect(result.errors).toEqual(["pagination_not_advancing"]);
	expect(result.complete).toBe(false);
});

test("report context recursively follows uncached replies and same sender windows over all history pages", async () => {
	const history = [
		msg("6", "d", 300000, "5"),
		msg("5", "c", 200000, "4"),
		msg("4", "c", 175000),
		msg("3", "b", 100000, "2"),
		msg("2", "a", 50000),
		msg("1", "a", 25000),
	];
	const calls: (string | undefined)[] = [];
	const result = await collectContext(
		history[4],
		async (before) => {
			calls.push(before);
			const start = before ? history.findIndex((m) => m.id === before) + 1 : 0;
			return history.slice(start, start + 2);
		},
		{ pageSize: 2 },
	);
	expect(calls).toEqual([undefined, "5", "3", "1"]);
	expect(result.messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
	expect(result.complete).toBe(true);
	expect(result.text).toContain("a [1]");
});
test("context expands recursively on both directions and every sender window", async () => {
	const history = [msg("5", "c", 220000, "4"), msg("4", "c", 195000, "3"), msg("3", "b", 100000, "2"), msg("2", "a", 50000), msg("1", "a", 25000)];
	const result = await collectContext(history[2], async () => history);
	expect(result.messages.map((m) => m.id)).toEqual(["1", "2", "3", "4", "5"]);
});
test("pagination errors, missing replies and safety bounds are explicit; other channels excluded", async () => {
	const original = msg("2", "a", 50000, "missing");
	const result = await collectContext(original, async () => [msg("1", "a", 25000), { ...msg("0", "a", 0), channelId: "foreign" }], {
		pageSize: 2,
		maxPages: 1,
		maxIncluded: 1,
	});
	expect(result.complete).toBe(false);
	expect(result.errors).toEqual(expect.arrayContaining(["history_safety_bound", "missing_reply:missing", "context_safety_bound"]));
	expect(result.messages).toEqual([original]);
	const failure = await collectContext(original, async () => {
		throw new Error("denied");
	});
	expect(failure.errors).toContain("history_fetch_failed");
});
