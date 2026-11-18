import type { SQL } from "bun";
import { postgresFromEnv } from "./postgres.js";

// Mail lives in SneakyMail's table sneakymail.mail. The bot only calls sneakymail.send (SneakyMail's
// db/migrations/V001), which checks the rewards and makes keyed sends idempotent; it never touches the table itself.

/** Run as console when the mail is claimed, with `{player}` replaced by the player's name. */
export type CommandReward = { type: "command"; command: string };

export type RewardMail = {
	/**
	 * Names this mail for good: sending the same key and content again returns the mail already sent instead of a
	 * second one. Build it only from data that stays the same when the send is retried.
	 */
	sourceKey: string;
	/** The Minecraft account's UUID. */
	recipientUuid: string;
	senderName: string;
	note: string;
	rewards: CommandReward[];
};

export interface MailSender {
	/**
	 * The mail's id (a bigint, as text). Retries connection trouble and serialization failures a few times. Rejects
	 * with SourceKeyReusedError when the key names a mail with other content.
	 */
	send(mail: RewardMail): Promise<string>;
}

/** The source key was already used for a mail with different content (SQLSTATE 23505). Nothing was sent. */
export class SourceKeyReusedError extends Error {
	constructor(
		readonly sourceKey: string,
		options: { cause: unknown },
	) {
		super(`source key ${sourceKey} already names a mail with different content`, options);
		this.name = "SourceKeyReusedError";
	}
}

/** Waits before each retry of a send that failed for a passing reason; one entry per retry. */
export type RetryPolicy = { delaysMs: readonly number[]; sleep: (ms: number) => Promise<void> };
export const DEFAULT_RETRY: RetryPolicy = { delaysMs: [1_000, 5_000], sleep: (ms) => Bun.sleep(ms) };

// Failures that say nothing about the mail itself. Retrying them is safe: if the first call committed before the
// connection dropped, the same key and content return that mail.
const TRANSIENT_CODES = new Set([
	"ERR_POSTGRES_CONNECTION_CLOSED",
	"ERR_POSTGRES_CONNECTION_FAILED",
	"ERR_POSTGRES_CONNECTION_REFUSED",
	"ERR_POSTGRES_CONNECTION_TIMEOUT",
	"ERR_POSTGRES_IDLE_TIMEOUT",
	"ERR_POSTGRES_LIFETIME_TIMEOUT",
]);
// Serialization failure, deadlock, server shutting down or starting, too many connections. Class 08 is a connection exception.
const TRANSIENT_SQLSTATES = new Set(["40001", "40P01", "57P01", "57P02", "57P03", "53300"]);

/** Connection trouble and serialization failures; never 23505 or data errors such as 22P02. */
export function isTransient(error: unknown): boolean {
	const state = sqlState(error);
	if (state) return state.startsWith("08") || TRANSIENT_SQLSTATES.has(state);
	return TRANSIENT_CODES.has(String((error as { code?: unknown } | null)?.code));
}

export class PostgresMailSender implements MailSender {
	constructor(
		private sql: SQL,
		private retry: RetryPolicy = DEFAULT_RETRY,
	) {}

	async send(mail: RewardMail): Promise<string> {
		for (let attempt = 0; ; attempt++) {
			try {
				return await this.sendOnce(mail);
			} catch (error) {
				if (sqlState(error) === "23505") throw new SourceKeyReusedError(mail.sourceKey, { cause: error });
				const delay = this.retry.delaysMs[attempt];
				if (delay === undefined || !isTransient(error)) throw error;
				console.warn(`SneakyMail: sending ${mail.sourceKey} failed (${describe(error)}); retrying in ${delay} ms`);
				await this.retry.sleep(delay);
			}
		}
	}

	private async sendOnce(mail: RewardMail): Promise<string> {
		// Bind the rewards themselves: Bun serializes them for jsonb, so a stringified value would arrive as a JSON string.
		const [row] = await this.sql<Array<{ id: string }>>`
			select sneakymail.send(${mail.sourceKey}, ${mail.recipientUuid}::uuid, ${mail.senderName}, ${mail.note},
				${mail.rewards}::jsonb, ${null}::timestamptz)::text as id`;
		return row.id;
	}
}

/**
 * The call that sends `mail` by hand (DBeaver, psql), for failure logs. The same key and content make it safe even if
 * the failed send did commit: then it returns that mail's id.
 */
export function resendStatement(mail: RewardMail): string {
	const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
	return `select sneakymail.send(${literal(mail.sourceKey)}, ${literal(mail.recipientUuid)}::uuid, ${literal(mail.senderName)}, ${literal(mail.note)}, ${literal(JSON.stringify(mail.rewards))}::jsonb, null);`;
}

/** Bun's PostgresError carries the SQLSTATE in `errno`. */
function sqlState(error: unknown): string | undefined {
	const errno = (error as { errno?: unknown } | null)?.errno;
	return errno == null ? undefined : String(errno);
}

function describe(error: unknown): string {
	return sqlState(error) ?? String((error as { code?: unknown } | null)?.code ?? (error as Error)?.message ?? error);
}

let shared: MailSender | null | undefined;
/** One sender for the bot, on the shared PostgreSQL connection; null when PGHOST isn't set. */
export function mailSenderFromEnv(): MailSender | null {
	if (shared === undefined) {
		const sql = postgresFromEnv();
		shared = sql ? new PostgresMailSender(sql) : null;
	}
	return shared;
}
