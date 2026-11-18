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
	/** The mail's id (a bigint, as text). Rejects with SourceKeyReusedError when the key names a mail with other content. */
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

export class PostgresMailSender implements MailSender {
	constructor(private sql: SQL) {}

	async send(mail: RewardMail): Promise<string> {
		try {
			// Bind the rewards themselves: Bun serializes them for jsonb, so a stringified value would arrive as a JSON string.
			const [row] = await this.sql<Array<{ id: string }>>`
				select sneakymail.send(${mail.sourceKey}, ${mail.recipientUuid}::uuid, ${mail.senderName}, ${mail.note},
					${mail.rewards}::jsonb, ${null}::timestamptz)::text as id`;
			return row.id;
		} catch (error) {
			if (sqlState(error) === "23505") throw new SourceKeyReusedError(mail.sourceKey, { cause: error });
			throw error;
		}
	}
}

/** Bun's PostgresError carries the SQLSTATE in `errno`. */
function sqlState(error: unknown): string | undefined {
	const errno = (error as { errno?: unknown } | null)?.errno;
	return errno == null ? undefined : String(errno);
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
