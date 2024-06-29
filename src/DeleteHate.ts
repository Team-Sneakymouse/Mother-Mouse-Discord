import { Client } from "discord.js";

const bannedEmojis = ["🖕", "regional_indicator", "no", "😡", "stop", "scam", "👎"];

const checkedUsers = ["416465357050609665", "919916816015437825"];

export default function RawbColor(client: Client) {
	client.on("messageReactionAdd", async (reaction, user) => {
		if (!checkedUsers.includes(user.id)) return;
		const addedEmoji = reaction.emoji.name || reaction.emoji.identifier;
		console.log(addedEmoji, `${reaction.message.channelId}/${reaction.message.id}`);

		if (bannedEmojis.some((bannedEmoji) => addedEmoji.toLowerCase().includes(bannedEmoji))) {
			console.log(`Deleting reaction ${addedEmoji} from ${user.tag}`);
			setTimeout(() => reaction.remove(), 1000 * 60);
		}
	});
}
