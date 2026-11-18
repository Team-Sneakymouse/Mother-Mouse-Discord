import { CronJob } from "cron";
import { Client, User } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
import type { AccountStore } from "./AccountManagement/store.js";
import { resendStatement, SourceKeyReusedError, type MailSender, type RewardMail } from "./utils/SneakyMail.js";

type SettingsRecord = RecordModel & {
	key: string;
	value: any;
};

/** One reward per message: Rawb reacting again, or Discord delivering the reaction twice, returns the same mail. */
export function redGemSourceKey(messageId: string): string {
	return `reaction:red-gem:${messageId}`;
}

/** Rawb's red-gem reward for a message, to the author's main Minecraft account. */
export function redGemRewardMail(messageId: string, recipientUuid: string): RewardMail {
	return {
		sourceKey: redGemSourceKey(messageId),
		recipientUuid,
		senderName: "<gold>Grand Paladin Order</gold>",
		note: `<i:false><white>You earned a <red>RED GEM</red> in the
<i:false><white><light_purple>r<aqua>a</aqua>w<aqua>b</aqua>.<aqua>t</aqua>v</light_purple> Discord server and
<i:false><white>received <dark_red><b><red>100 Dragon Coins</red></b></dark_red>!`,
		rewards: [{ type: "command", command: `ms cast as {player} mail-redGemReward` }],
	};
}

const LAST_TIMESTAMP_ID = "p6989yx87943q9y";
const RAWB_USER_ID = "90956966947467264";

/**
 * Accounts come from SneakyUserMeta's tables (`accounts`) and mail goes to SneakyMail's (`mail`); the reminder
 * timestamp is still PocketBase's.
 */
export default function ReactionRewards(client: Client, db: PocketBase, accounts: AccountStore | null, mail: MailSender | null) {
	new CronJob("0 0 18 * * *", async () => {
		const lastTimestampRecord = await db
			.collection("settings")
			.getOne<SettingsRecord>(LAST_TIMESTAMP_ID)
			.catch((e) => {
				if (e.status === 404) return null;
				throw e;
			});
		if (!lastTimestampRecord || lastTimestampRecord.value) return;
		// check if it's been more than 5 days
		const lastTimestamp = new Date(lastTimestampRecord.value).getTime();
		if (Date.now() - lastTimestamp > 5 * 24 * 60 * 60 * 1000) {
			await db.collection("settings").update(LAST_TIMESTAMP_ID, { value: new Date().toISOString() });
			const rawb = await client.users.fetch(RAWB_USER_ID);
			const rawbDm = rawb.dmChannel;
			const msg = await rawbDm?.send("It has been over 5 days since the last <:robRedGem:631970752576487463> reaction.");
			await msg?.react("robRedGem:631970752576487463");
		}
	}).start();

	client.on("messageReactionAdd", async (reaction, user) => {
		// if (reaction.message.guildId !== "391355330241757205") return; //rawb.tv
		if (user.id !== RAWB_USER_ID) return;
		if (reaction.partial) {
			try {
				await reaction.fetch();
			} catch (error) {
				console.error("Something went wrong when fetching the message:", error);
				return;
			}
		}
		if (!reaction.message.author) return;

		switch (reaction.emoji.identifier) {
			case "robRedGem:631970752576487463":
				return awardDragoncoins(db, accounts, mail, reaction.message.author, reaction.message.id);
		}
	});
}

/**
 * Sends the red-gem reward for `messageId` to the main account of its author, or tells them to link one. Never
 * rejects: it runs in a Discord listener, where a rejection would surface as an unhandled client error.
 */
export async function awardDragoncoins(
	db: PocketBase,
	accounts: AccountStore | null,
	mail: MailSender | null,
	discordUser: User,
	messageId: string,
): Promise<void> {
	const what = `red gem for message ${messageId} (source key ${redGemSourceKey(messageId)})`;
	if (!accounts || !mail) return console.error(`ReactionRewards: no PostgreSQL database (PGHOST unset); no Dragon Coins sent for ${what}`);
	let account: { uuid: string; name: string } | null = null;
	let sent = false;
	try {
		account = await accounts.mainAccountForDiscord(discordUser.id);
		if (account == null) {
			const dmChannel = discordUser.dmChannel || (await discordUser.createDM());
			if (dmChannel == null) return console.error(`Could not create DM channel with user ${discordUser.tag} (${discordUser.id})`);
			await dmChannel.send(
				"Rawb tried to give you 100 Dragon Coins, but you don't have your Minecraft account linked in Minecraft.\nYou can do that with `/accounts` in any rawb.tv channel to receive rewards in the future!",
			);
			return;
		}
		await mail.send(redGemRewardMail(messageId, account.uuid));
		sent = true;
		await db.collection("settings").update(LAST_TIMESTAMP_ID, { value: new Date().toISOString() });
	} catch (error) {
		const to = account ? ` to ${account.name} (${account.uuid})` : "";
		let outcome: string;
		if (sent) outcome = `Dragon Coins sent${to}, but updating the reminder timestamp failed`;
		else if (error instanceof SourceKeyReusedError) outcome = `no Dragon Coins sent${to}: the key already names a mail with different content`;
		else if (account) outcome = `Dragon Coins mail${to} not confirmed; it may already exist. Resend by hand (safe, same key): ${resendStatement(redGemRewardMail(messageId, account.uuid))}`;
		else outcome = "no Dragon Coins sent: looking up the author's main account failed";
		console.error(`ReactionRewards: ${what}: ${outcome}`, error);
	}
}
