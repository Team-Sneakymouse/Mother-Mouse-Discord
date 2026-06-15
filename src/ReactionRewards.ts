import { CronJob } from "cron";
import { Client, User } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

type MailModel = RecordModel & {
	sender_uuid?: string;
	sender_name?: string;
	recipient_uuid?: string;
	recipient_name?: string;
	note: string;
	available: true;
	rewards: { type: "command"; command: string }[];
};
type LomUserRecord = RecordModel & {
	id: string;
	name: string;
	owner: string;
	main: boolean;
};
type SettingsRecord = RecordModel & {
	key: string;
	value: any;
};

export default function ReactionRewards(client: Client, db: PocketBase) {
	const LAST_TIMESTAMP_ID = "p6989yx87943q9y";
	const RAWB_USER_ID = "90956966947467264";
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
				return awardDragoncoins(reaction.message.author);
		}
	});

	async function awardDragoncoins(discordUser: User) {
		const account = await db
			.collection("lom2_accounts")
			.getFirstListItem<LomUserRecord>(`owner.discord_id="${discordUser.id}" && main=true`)
			.catch((e: any) => {
				if (e.status === 404) return null;
				throw e;
			});
		if (account == null) {
			const dmChannel = discordUser.dmChannel || (await discordUser.createDM());
			if (dmChannel == null) return console.error(`Could not create DM channel with user ${discordUser.tag} (${discordUser.id})`);
			dmChannel.send(
				"Rawb tried to give you 100 Dragon Coins, but you don't have your Minecraft account linked in Minecraft.\nYou can do that with `/accounts` in any rawb.tv channel to receive rewards in the future!",
			);
			return;
		}

		await db.collection("lom2_mail").create<MailModel>({
			sender_name: "<gold>Grand Paladin Order</gold>",
			recipient_name: account.name,
			recipient_uuid: account.id,
			note: `<i:false><white>You earned a <red>RED GEM</red> in the
<i:false><white><light_purple>r<aqua>a</aqua>w<aqua>b</aqua>.<aqua>t</aqua>v</light_purple> Discord server and
<i:false><white>received <dark_red><b><red>100 Dragon Coins</red></b></dark_red>!`,
			available: true,
			rewards: [{ type: "command", command: `ms cast as {player} mail-redGemReward` }],
		});
		await db.collection("settings").update(LAST_TIMESTAMP_ID, { value: new Date().toISOString() });
	}
}
