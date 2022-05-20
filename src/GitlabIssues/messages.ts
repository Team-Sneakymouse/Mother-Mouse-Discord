import { Gitlab } from "@gitbeaker/node";
import { ChannelType, Client, Message, ThreadChannel } from "discord.js";
import { projectIds, Projects } from "./utils";

export default function (client: Client, gitlab: InstanceType<typeof Gitlab>) {
	return {
		matcher: function (message: Message) {
			return (
				message.channel?.type == ChannelType.GuildPublicThread &&
				message.channel.ownerId === "713723936231129089" &&
				// message.channel.name.startsWith("#") &&
				!message.author.bot
			);
		},
		handler: async function (message: Message) {
			const channel = message.channel as ThreadChannel;
			const starterMessage = await channel.fetchStarterMessage();
			const project_id = projectIds[message.guildId as Projects];
			const issueid = parseInt(starterMessage.embeds[0].footer?.text.match(/\d+/)?.[0] as string);

			if (!project_id) return console.error(`No project id found for server ${message.guild?.name} (${message.guildId})`);
			if (!issueid) return console.error(`No issue id found on message ${starterMessage.channelId}/${starterMessage.id}`);

			const text = `![Profile Image](${message.author.avatarURL({ size: 16 })}) **${message.author.username}** via [#${
				channel.name
			}](${channel.url})\n\n---\n${message.content.replaceAll(/([^\n\s])\n([^\n\s])/g, "$1  \n$2")}`;

			const comment = await gitlab.IssueNotes.create(project_id, issueid, text);
		},
	};
}
