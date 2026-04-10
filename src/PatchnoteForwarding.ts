import { Channel, Client, ColorResolvable, Role, Snowflake, TextChannel } from "discord.js";

const RAWBTV_SERVER = "391355330241757205";
const TECHTEAM_ROLE = "816744626751799366";
const PATCHNOTES_CHANNEL = "1486515285870776380";

const IGNORED_CHANNELS: string[] = [];
const IGNORED_CHANNEL_TERMS: (string | RegExp)[] = ["Submissions"];

function isIgnored(channel: Channel): boolean {
	if (channel.isDMBased()) return true;
	if (IGNORED_CHANNELS.includes(channel.id)) return true;
	if (IGNORED_CHANNEL_TERMS.some((term) => channel.name.match(term))) return true;
	return false;
}

export default function PatchnoteForwarding(client: Client) {
	client.on("messageReactionAdd", async (reaction, user) => {
		if (!reaction.message.guild) return;
		if (reaction.message.guildId !== RAWBTV_SERVER) return;
		if (isIgnored(reaction.message.channel)) return;

		const member = reaction.message.guild?.members.cache.get(user.id);
		if (!member) return;
		if (user.bot || !member.roles.cache.has(TECHTEAM_ROLE)) return;

		if (reaction.emoji.name !== "✅" && reaction.emoji.identifier !== "✅") return;

		const channel = client.channels.cache.get(PATCHNOTES_CHANNEL) as TextChannel;
		if (!channel) {
			console.error("Can't find patchnotes channel!");
			return;
		}
		await channel.send("Fixed:");
		await reaction.message.forward(channel);
	});
}
