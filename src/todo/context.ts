export interface ContextMessage {
 id: string; channelId: string; senderId: string; senderName: string; timestamp: number;
 content: string; attachments: { url: string; name: string | null; contentType?: string | null }[]; replyTo?: string;
}
export interface ReportContext { messages: ContextMessage[]; text: string; complete: boolean; errors: string[]; pages: number; scanned: number }
/** Discord has no reverse-reply lookup: paginate the entire source channel, never its cache. */
export async function collectContext(original: ContextMessage, page: (before?: string) => Promise<ContextMessage[]>, options: {pageSize?: number; maxPages?: number; maxMessages?: number; maxIncluded?: number} = {}): Promise<ReportContext> {
 const {pageSize = 100, maxPages = 1000, maxMessages = 100000, maxIncluded = 5000} = options;
 const all = new Map<string, ContextMessage>([[original.id, original]]);
 const errors: string[] = []; let pages = 0; let before: string | undefined; let exhausted = false;
 while (pages < maxPages && all.size < maxMessages) {
  let batch: ContextMessage[];
  try { batch = await page(before); pages++; } catch { errors.push("history_fetch_failed"); break; }
  for (const message of batch) if (message.channelId === original.channelId) all.set(message.id, message);
  if (batch.length < pageSize) { exhausted = true; break; }
  const next = batch.at(-1)?.id;
  if (!next || next === before) { errors.push("pagination_not_advancing"); break; }
  before = next;
 }
 if (!exhausted && !errors.length) errors.push("history_safety_bound");
 const included = new Map<string, ContextMessage>([[original.id, original]]);
 const queue = [original];
 for (let i = 0; i < queue.length; i++) {
  const current = queue[i];
  if (current.replyTo && !all.has(current.replyTo)) errors.push(`missing_reply:${current.replyTo}`);
  for (const candidate of all.values()) {
   if (included.has(candidate.id)) continue;
   if (candidate.id === current.replyTo || candidate.replyTo === current.id || (candidate.senderId === current.senderId && Math.abs(candidate.timestamp - current.timestamp) <= 30000)) {
    if (included.size >= maxIncluded) { errors.push("context_safety_bound"); continue; }
    included.set(candidate.id, candidate); queue.push(candidate);
   }
  }
 }
 const messages = [...included.values()].sort((a,b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id, undefined, {numeric:true}));
 const uniqueErrors = [...new Set(errors)];
 return { messages, text: messages.map(m => `### ${m.senderName} [${m.id}] — ${new Date(m.timestamp).toISOString()}\n${m.content}${m.attachments.map(a => `\nAttachment: ${a.name ?? "file"} ${a.url}`).join("")}`).join("\n\n"), complete: !uniqueErrors.length, errors: uniqueErrors, pages, scanned: all.size };
}
