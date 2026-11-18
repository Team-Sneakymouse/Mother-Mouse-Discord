import { SQL } from "bun";

// Users, Minecraft accounts and Twitch identities live in SneakyUserMeta's schema `sneakyusermeta`. Every change goes
// through its linking functions (SneakyUserMeta's db/migrations/V002__account_linking.sql), which hold the rules
// that Minecraft and the shop follow too; this file only reads the tables and calls those functions.

/** What a linking function reports instead of raising an error. */
export type LinkStatus = "ok" | "invalid" | "wrong_side" | "other_owner" | "already_linked" | "not_linked" | "already_main";

export type MinecraftAccount = { uuid: string; name: string; isMain: boolean; firstSeen: Date };
export type TwitchIdentity = { twitchId: string; displayName: string; profileImageUrl: string };
export type TwitchGrant = { accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[] };

/** A user's id in sneakyusermeta.users. A bigint, kept as text so it never loses precision. */
export type UserId = string;

export interface AccountStore {
	/** The user of a Discord account, created under `name` the first time. */
	userForDiscord(discordId: string, name: string): Promise<UserId>;
	/** The user's linked Minecraft accounts, main first, then oldest first. */
	accounts(user: UserId): Promise<MinecraftAccount[]>;
	twitch(user: UserId): Promise<TwitchIdentity | null>;
	/** A five-digit token to type into Minecraft; the same one while it is valid. */
	linkTokenForUser(user: UserId): Promise<string>;
	/** Redeems a token made in Minecraft. `account` is set for ok and already_linked. */
	redeemForUser(token: string, user: UserId): Promise<{ status: LinkStatus; account?: { uuid: string; name: string; isMain: boolean } }>;
	setMain(user: UserId, uuid: string): Promise<LinkStatus>;
	/** `newMain` is the account that became main because the unlinked one was. */
	unlink(user: UserId, uuid: string): Promise<{ status: LinkStatus; accountName?: string; newMain?: { uuid: string; name: string } }>;
	/** Replaces the user's Twitch account; `moved` when it was linked to another user before. */
	linkTwitch(user: UserId, identity: TwitchIdentity, grant: TwitchGrant): Promise<{ moved: boolean }>;
	unlinkTwitch(user: UserId): Promise<boolean>;
	/** The main Minecraft account of a Discord user, or null when they have none linked. */
	mainAccountForDiscord(discordId: string): Promise<{ uuid: string; name: string } | null>;
	/** Every Minecraft account seen in game since `since`, linked or not. */
	accountsSeenSince(since: Date): Promise<Array<{ uuid: string; name: string }>>;
}

let shared: AccountStore | null | undefined;
/** One store for the bot, from the PG* settings; null when PGHOST isn't set. */
export function accountStoreFromEnv(): AccountStore | null {
	if (shared === undefined) shared = process.env.PGHOST ? new PostgresAccountStore(new SQL()) : null;
	return shared;
}

export class PostgresAccountStore implements AccountStore {
	constructor(private sql: SQL) {}

	async userForDiscord(discordId: string, name: string): Promise<UserId> {
		const [row] = await this.sql<Array<{ id: string }>>`select sneakyusermeta.user_for_discord(${discordId}, ${name})::text as id`;
		return row.id;
	}

	async accounts(user: UserId): Promise<MinecraftAccount[]> {
		const rows = await this.sql<Array<{ uuid: string; name: string; is_main: boolean; first_seen: Date }>>`
			select uuid::text, name, is_main, first_seen from sneakyusermeta.accounts
			where user_id = ${user}::bigint order by is_main desc, first_seen, uuid`;
		return rows.map((r) => ({ uuid: r.uuid, name: r.name, isMain: r.is_main, firstSeen: new Date(r.first_seen) }));
	}

	async twitch(user: UserId): Promise<TwitchIdentity | null> {
		const [row] = await this.sql<Array<{ twitch_id: string; display_name: string; profile_image_url: string }>>`
			select twitch_id, display_name, profile_image_url from sneakyusermeta.twitch_accounts where user_id = ${user}::bigint`;
		return row ? { twitchId: row.twitch_id, displayName: row.display_name, profileImageUrl: row.profile_image_url } : null;
	}

	async linkTokenForUser(user: UserId): Promise<string> {
		const [row] = await this.sql<Array<{ token: string }>>`select sneakyusermeta.link_token_for_user(${user}::bigint) as token`;
		return row.token;
	}

	async redeemForUser(token: string, user: UserId) {
		const [row] = await this.sql<Array<{ status: LinkStatus; account_uuid: string | null; account_name: string | null; is_main: boolean | null }>>`
			select status, account_uuid::text, account_name, is_main from sneakyusermeta.redeem_link_token_for_user(${token}, ${user}::bigint)`;
		return {
			status: row.status,
			account: row.account_uuid ? { uuid: row.account_uuid, name: row.account_name ?? "", isMain: row.is_main === true } : undefined,
		};
	}

	async setMain(user: UserId, uuid: string): Promise<LinkStatus> {
		const [row] = await this.sql<Array<{ status: LinkStatus }>>`select sneakyusermeta.set_main_account(${user}::bigint, ${uuid}::uuid) as status`;
		return row.status;
	}

	async unlink(user: UserId, uuid: string) {
		const [row] = await this.sql<Array<{ status: LinkStatus; account_name: string | null; new_main_uuid: string | null; new_main_name: string | null }>>`
			select status, account_name, new_main_uuid::text, new_main_name from sneakyusermeta.unlink_account(${user}::bigint, ${uuid}::uuid)`;
		return {
			status: row.status,
			accountName: row.account_name ?? undefined,
			newMain: row.new_main_uuid ? { uuid: row.new_main_uuid, name: row.new_main_name ?? "" } : undefined,
		};
	}

	async linkTwitch(user: UserId, identity: TwitchIdentity, grant: TwitchGrant) {
		const [row] = await this.sql<Array<{ moved: boolean }>>`
			select moved from sneakyusermeta.link_twitch(
				${user}::bigint, ${identity.twitchId}, ${identity.displayName}, ${identity.profileImageUrl},
				${grant.accessToken}, ${grant.refreshToken}, ${grant.expiresAt}, string_to_array(${grant.scopes.join(" ")}, ' '))`; // Twitch scopes have no spaces
		return { moved: row.moved };
	}

	async mainAccountForDiscord(discordId: string) {
		const [row] = await this.sql<Array<{ uuid: string; name: string }>>`
			select a.uuid::text, a.name from sneakyusermeta.accounts a join sneakyusermeta.users u on u.id = a.user_id
			where u.discord_id = ${discordId} and a.is_main`;
		return row ?? null;
	}

	async accountsSeenSince(since: Date) {
		return await this.sql<Array<{ uuid: string; name: string }>>`
			select uuid::text, name from sneakyusermeta.accounts where last_seen >= ${since} order by name`;
	}

	async unlinkTwitch(user: UserId): Promise<boolean> {
		const [row] = await this.sql<Array<{ removed: boolean }>>`select sneakyusermeta.unlink_twitch(${user}::bigint) as removed`;
		return row.removed;
	}
}

/** Mixed-up or guessed tokens: at most `max` wrong ones per Discord user within `windowMs`. Tokens have five digits. */
export class LinkAttempts {
	private failures = new Map<string, number[]>();
	constructor(
		private max = 5,
		private windowMs = 10 * 60 * 1000,
		private now: () => number = Date.now,
	) {}

	blocked(user: string): boolean {
		return this.recent(user).length >= this.max;
	}

	failed(user: string): void {
		this.failures.set(user, [...this.recent(user), this.now()]);
	}

	private recent(user: string): number[] {
		const cutoff = this.now() - this.windowMs;
		const times = (this.failures.get(user) ?? []).filter((t) => t > cutoff);
		if (times.length === 0) this.failures.delete(user);
		else this.failures.set(user, times);
		return times;
	}
}
