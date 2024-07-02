import { Client } from "discord.js";

const bannedEmojis = ["🖕", "regional_indicator", "no", "😡", "stop", "scam", "👎"];

const checkedRoles = ["1251600130147356762"];

export default function RawbColor(client: Client) {
	client.on("messageReactionAdd", async (reaction, user) => {
		const member = reaction.message.guild?.members.cache.get(user.id);
		if (!member) return;
		if (!checkedRoles.some((role) => member.roles.cache.has(role))) return;
		const addedEmoji = reaction.emoji.name || reaction.emoji.identifier;
		console.log(addedEmoji, `${reaction.message.channelId}/${reaction.message.id}`);

		if (bannedEmojis.some((bannedEmoji) => addedEmoji.toLowerCase().includes(bannedEmoji))) {
			console.log(`Deleting reaction ${addedEmoji} from ${user.tag}`);
			setTimeout(() => reaction.remove(), 1000 * 60);
		}
	});
}
