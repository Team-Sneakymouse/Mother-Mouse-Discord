import { Client, messageLink, User } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

type MailModel = RecordModel & {
	sender_uuid?: string;
	sender_name?: string;
	recipient_uuid?: string;
	recipient_name?: string;
	note: string;
	available: true;
	rewards: { type: "command", command: string }[];
}
type LomUserRecord = RecordModel & {
	id: string;
	name: string;
	owner: string;
	main: boolean;
};

export default function RawbColor(client: Client, db: PocketBase) {
	client.on("messageReactionAdd", async (reaction, user) => {
		// if (reaction.message.guildId !== "391355330241757205") return; //rawb.tv
		if (user.id !== "90956966947467264") return; //rawb
		if (!reaction.message.author) return;

		switch (reaction.emoji.identifier) {
			case "631970752576487463": return awardDragoncoins(reaction.message.author, 100);
		}
	});

	async function awardDragoncoins(discordUser: User, amount: number) {
		const account = await db.collection("lom2_accounts").getFirstListItem<LomUserRecord>(`owner.discord_id="${discordUser.id}" && main=true`).catch((e: any) => {
			if (e.status === 404) return null;
			throw e;
		});
		if (account == null) {
			discordUser.dmChannel?.send("Rawb tried to give you 100 Dragon Coins, but you don't have your Minecraft account linked in Minecraft.\nYou can do that with `/accounts` in any rawb.tv channel to receive rewards in the future!");
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
	}
}