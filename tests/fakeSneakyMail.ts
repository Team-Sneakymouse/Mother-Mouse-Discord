import { SQL } from "bun";
import type { RewardMail } from "../src/utils/SneakyMail.ts";

export type SentMail = RewardMail & { expiresAt: unknown };

/**
 * Stands in for PostgreSQL behind PostgresMailSender. Every query is a sneakymail.send call; the fake keeps
 * sneakymail.send's source-key rules (same key and content: the same id; other content: SQLSTATE 23505).
 * `fail` can throw for a mail before it is stored.
 */
export function fakeSneakyMailSql(fail?: (mail: SentMail) => void) {
	const queries: { text: string; values: unknown[] }[] = [];
	const sent: SentMail[] = [];
	const keys = new Map<string, { id: string; content: string }>();
	const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
		queries.push({ text: strings.join("$"), values });
		const [sourceKey, recipientUuid, senderName, note, rewards, expiresAt] = values as [string, string, string, string, unknown, unknown];
		// Bun encodes a bound string for jsonb as a JSON string, which sneakymail.rewards_valid rejects.
		if (!Array.isArray(rewards))
			throw new SQL.PostgresError('new row for relation "mail" violates check constraint "mail_rewards_check"', {
				code: "ERR_POSTGRES_SERVER_ERROR",
				errno: "23514",
			});
		const mail: SentMail = { sourceKey, recipientUuid, senderName, note, rewards: structuredClone(rewards), expiresAt };
		fail?.(mail);
		const content = JSON.stringify(values.slice(1));
		const existing = keys.get(sourceKey);
		if (existing) {
			if (existing.content === content) return [{ id: existing.id }];
			throw new SQL.PostgresError(`sneakymail.send: source key ${sourceKey} was reused with different content`, {
				code: "ERR_POSTGRES_SERVER_ERROR",
				errno: "23505",
			});
		}
		sent.push(mail);
		const id = String(sent.length);
		keys.set(sourceKey, { id, content });
		return [{ id }];
	}) as unknown as SQL;
	return { sql, sent, queries };
}
