export interface ContextMessage {
	id: string;
	channelId: string;
	senderId: string;
	senderName: string;
	timestamp: number;
	content: string;
	attachments: { url: string; name: string | null; contentType?: string | null }[];
	replyTo?: string;
}
export interface ReportContext {
	messages: ContextMessage[];
	text: string;
	complete: boolean;
	errors: string[];
	pages: number;
	scanned: number;
}

const yieldToInteractions = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Bottom-up merge sort also yields: a large history must not monopolize the event loop while sorting. */
async function cooperativeSort<T>(items: T[], compare: (a: T, b: T) => number, checkpoint: () => boolean): Promise<T[]> {
	let source = items;
	let target = new Array<T>(items.length);
	for (let width = 1; width < items.length; width *= 2) {
		for (let start = 0; start < items.length; start += width * 2) {
			const middle = Math.min(start + width, items.length);
			const end = Math.min(start + width * 2, items.length);
			let left = start;
			let right = middle;
			for (let i = start; i < end; i++) {
				target[i] = left < middle && (right >= end || compare(source[left], source[right]) <= 0) ? source[left++] : source[right++];
				if (checkpoint()) await yieldToInteractions();
			}
		}
		[source, target] = [target, source];
	}
	return source;
}

interface ContextNode {
	message: ContextMessage;
	id: string;
	sender: string;
	time: number;
	replyTo?: string;
	neighbors: ContextNode[];
}

/** Discord has no reverse-reply lookup: paginate the entire source channel, never its cache. */
export async function collectContext(
	original: ContextMessage,
	page: (before?: string) => Promise<ContextMessage[]>,
	options: { pageSize?: number; maxPages?: number; maxMessages?: number; maxIncluded?: number } = {},
): Promise<ReportContext> {
	const { pageSize = 100, maxPages = 1000, maxMessages = 100000, maxIncluded = 5000 } = options;
	let work = 0;
	const checkpoint = () => ++work % 1024 === 0;
	const all = new Map<string, ContextMessage>([[original.id, original]]);
	const errors = new Set<string>();
	let pages = 0;
	let before: string | undefined;
	let exhausted = false;
	while (pages < maxPages && all.size < maxMessages) {
		let batch: ContextMessage[];
		try {
			batch = await page(before);
			pages++;
		} catch {
			errors.add("history_fetch_failed");
			break;
		}
		for (const message of batch) {
			if (message.channelId === original.channelId) {
				if (!all.has(message.id) && all.size >= maxMessages) {
					errors.add("history_safety_bound");
					break;
				}
				all.set(message.id, message);
			}
			if (checkpoint()) await yieldToInteractions();
		}
		if (errors.has("history_safety_bound")) break;
		if (batch.length < pageSize) {
			exhausted = true;
			break;
		}
		const next = batch.at(-1)?.id;
		if (!next || next === before) {
			errors.add("pagination_not_advancing");
			break;
		}
		before = next;
	}
	if (!exhausted && !errors.size) errors.add("history_safety_bound");

	const nodes = new Map<string, ContextNode>();
	for (const [id, fetched] of all) {
		// The explicitly selected seed remains available even when absent from history.
		const message = id === original.id ? original : fetched;
		nodes.set(id, { message, id, sender: message.senderId, time: message.timestamp, replyTo: message.replyTo, neighbors: [] });
		if (checkpoint()) await yieldToInteractions();
	}
	const connect = (a: ContextNode, b: ContextNode) => {
		a.neighbors.push(b);
		b.neighbors.push(a);
	};
	for (const node of nodes.values()) {
		const parent = node.replyTo ? nodes.get(node.replyTo) : undefined;
		if (parent) connect(node, parent);
		if (checkpoint()) await yieldToInteractions();
	}
	const bySender = await cooperativeSort([...nodes.values()], (a, b) => (a.sender < b.sender ? -1 : a.sender > b.sender ? 1 : a.time - b.time), checkpoint);
	for (let i = 1; i < bySender.length; i++) {
		const previous = bySender[i - 1];
		const current = bySender[i];
		// Adjacent timestamps preserve exactly the transitive closure of all ±30s
		// windows, but even a dense sender burst has only linear many edges.
		if (previous.sender === current.sender && current.time - previous.time <= 30000) connect(previous, current);
		if (checkpoint()) await yieldToInteractions();
	}

	const seed = nodes.get(original.id)!;
	const included = new Set<string>([seed.id]);
	const queue = [seed];
	for (let i = 0; i < queue.length; i++) {
		const current = queue[i];
		if (current.replyTo && !nodes.has(current.replyTo)) errors.add(`missing_reply:${current.replyTo}`);
		for (const candidate of current.neighbors) {
			if (!included.has(candidate.id)) {
				if (included.size >= maxIncluded) errors.add("context_safety_bound");
				else {
					included.add(candidate.id);
					queue.push(candidate);
				}
			}
			if (checkpoint()) await yieldToInteractions();
		}
		if (checkpoint()) await yieldToInteractions();
	}
	const chronological = await cooperativeSort(queue, (a, b) => a.time - b.time || a.id.localeCompare(b.id, undefined, { numeric: true }), checkpoint);
	const messages: ContextMessage[] = [];
	const text: string[] = [];
	for (const node of chronological) {
		const m = node.message;
		messages.push(m);
		text.push(
			`### ${m.senderName} [${m.id}] — ${new Date(m.timestamp).toISOString()}\n${m.content}${m.attachments.map((a) => `\nAttachment: ${a.name ?? "file"} ${a.url}`).join("")}`,
		);
		if (checkpoint()) await yieldToInteractions();
	}
	return { messages, text: text.join("\n\n"), complete: !errors.size, errors: [...errors], pages, scanned: all.size };
}
