import { Client } from "discord.js";

const bannedEmojis = ["🖕", "regional_indicator", "no", "😡", "stop"];

const checkedUsers = ["416465357050609665"];

export default function RawbColor(client: Client) {
	client.on("messageReactionAdd", async (reaction, user) => {
		if (!checkedUsers.includes(user.id)) return;
		const addedEmoji = reaction.emoji.name || reaction.emoji.identifier;
		console.log(addedEmoji, `${reaction.message.channelId}/${reaction.message.id}`);

		if (bannedEmojis.some((bannedEmoji) => addedEmoji.toLowerCase().includes(bannedEmoji))) {
			console.log(`Deleting reaction ${addedEmoji} from ${user.tag}`);
			setTimeout(() => reaction.users.remove(), 1000 * 60);
		}
	});
}
