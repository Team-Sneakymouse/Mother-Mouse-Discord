import { Client, TextChannel } from "discord.js";

const RAWBTV_SERVER_ID = "391355330241757205";
const MOD_CHANNEL_ID = "688137973698658360";
const LOG_THREAD_ID = "1159792578619768882";
const JOIN_LEAVE_THREAD_ID = "1252000364971163801";

export default function MediaEmbeds(client: Client) {
	client.on("messageUpdate", async (oldMessage, newMessage) => {
		if (oldMessage.guildId !== RAWBTV_SERVER_ID) return;
		if (oldMessage.content === newMessage.content) return console.log("same content", newMessage.url);
		if (oldMessage.author?.bot) return;

		const channel = client.channels.cache.get(MOD_CHANNEL_ID) as TextChannel;
		if (!channel) return console.log("deletelog - unknown channel");
		const thread = channel.threads.cache.get(LOG_THREAD_ID);
		if (!thread) return console.log("deletelog - unknown thread");

		thread.send({
			content: "",
			embeds: [
				{
					author: {
						name: `${oldMessage.author?.username ?? oldMessage.author?.globalName ?? "Unknown User"}`,
						icon_url: oldMessage.author?.displayAvatarURL() ?? undefined,
					},
					title: `Message edited in <#${oldMessage.channelId}>`,
					url: newMessage.url,
					description: `${oldMessage.content ?? "*Message wasn't cached*"}\n\n------\n\n${
						newMessage.content ?? "*Mother Mouse can't see message"
					}`,
					color: 0xeb9e34,
					timestamp: newMessage.createdAt.toISOString(),
				},
			],
		});
	});

	client.on("messageDelete", async (message) => {
		if (message.guildId !== RAWBTV_SERVER_ID) return;
		if (message.channelId === LOG_THREAD_ID) return;

		const channel = client.channels.cache.get(MOD_CHANNEL_ID) as TextChannel;
		if (!channel) return console.log("deletelog - unknown channel");
		const thread = channel.threads.cache.get(LOG_THREAD_ID);
		if (!thread) return console.log("deletelog - unknown thread");

		thread.send({
			content: "",
			embeds: [
				{
					author: {
						name: `${message.author?.username ?? message.author?.globalName ?? "Unknown User"}`,
						icon_url: message.author?.displayAvatarURL() ?? undefined,
					},
					title: `Message deleted in <#${message.channelId}>`,
					description: message.content ?? "*Message wasn't cached*",
					color: 0xeb4034,
					timestamp: message.createdAt?.toISOString(),
				},
			],
		});
	});

	client.on("guildMemberAdd", async (member) => {
		if (member.guild.id !== RAWBTV_SERVER_ID) return;

		const channel = client.channels.cache.get(MOD_CHANNEL_ID) as TextChannel;
		if (!channel) return console.log("deletelog - unknown channel");
		const thread = channel.threads.cache.get(JOIN_LEAVE_THREAD_ID);
		if (!thread) return console.log("deletelog - unknown thread");

		const username = member.user?.username ?? "Unknown User";
		const joinMessage = `➕ **${username}** (${member.id}) has joined the server.`;
		thread.send(joinMessage);

		const lomchannel = client.channels.cache.get("1178373136857710592") as TextChannel;
		if (!lomchannel) return console.log("deletelog - unknown channel");
		lomchannel.permissionOverwrites.create(member.id, {
			ViewChannel: false,
		});

		const muteRole = member.guild.roles.cache.get("1251600130147356762")!;
		const dvzRole = member.guild.roles.cache.get("1164552739422994553")!;

		member.roles.add(muteRole);
		member.roles.remove(dvzRole);
	});

	client.on("guildMemberRemove", async (member) => {
		if (member.guild.id !== RAWBTV_SERVER_ID) return;

		const channel = client.channels.cache.get(MOD_CHANNEL_ID) as TextChannel;
		if (!channel) return console.log("deletelog - unknown channel");
		const thread = channel.threads.cache.get(JOIN_LEAVE_THREAD_ID);
		if (!thread) return console.log("deletelog - unknown thread");

		const username = member.user?.username ?? "Unknown User";
		const leaveMessage = `❌ **${username}** (${member.id}) has left the server.`;
		thread.send(leaveMessage);
	});
}
