import { ChannelType, Client, Emoji, TextChannel } from "discord.js";

const guildId = "391355330241757205";
const channelId = "1102684399948009522";
const validEmojis = ["🌟", "⭐", "GOLDSTAR:1102685154272628736", "a:aGOLDSTAR:441915851411816448"];

function isStar(emoji: Emoji) {
	return validEmojis.includes(emoji.name ?? "") || validEmojis.includes(emoji.identifier);
}

export default function Starboard(client: Client) {
	client.on("messageReactionAdd", async (reaction) => {
		if (reaction.message.guildId !== guildId) return;
		if (!isStar(reaction.emoji)) return;

		let count = 0;
		await reaction.message.fetch();
		for (const r of reaction.message.reactions.cache.values()) {
			if (!isStar(r.emoji)) continue;
			if (r.users.cache.has(reaction.client.user.id)) return; // Already starred this message
			if (validEmojis.includes(r.emoji.identifier)) count += r.count;
		}
		if (count < 5) return; // Not enough stars
		await reaction.message.react("1102685154272628736");

		const sourceChannel = reaction.message.channel;
		if (sourceChannel.isDMBased()) return;

		(client.channels.cache.get(channelId) as TextChannel).send({
			content: "",
			embeds: [
				{
					author: {
						name: (reaction.message.member?.displayName ?? "Unknown") + " - 🔗",
						icon_url: reaction.message.author?.avatarURL() ?? undefined,
						url: reaction.message.url,
					},
					color: 0xe0bb00,
					url: reaction.message.url,

					description: reaction.message.content ?? "",
					footer: {
						text: `#${sourceChannel.name}`,
					},
				},
			],
		});
	});
}
