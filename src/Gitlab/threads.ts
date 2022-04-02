import { Gitlab } from "@gitbeaker/node";
import { ChannelType, Client, ThreadChannel } from "discord.js";
import { projectIds, Projects } from "./utils";

export default function (client: Client, gitlab: InstanceType<typeof Gitlab>) {
	return {
		matcher: function (t: ThreadChannel): t is ThreadChannel {
			return t.type === ChannelType.GuildPublicThread && t.ownerId === client.user?.id && t.archived === true;
		},
		handler: async function (t: ThreadChannel) {
			const starterMessage = await t.fetchStarterMessage();
			const projectId = projectIds[t.guildId as Projects];
			const issueId = parseInt(starterMessage.embeds[0].footer?.text.match(/\d+/)?.[0] as string);
			if (!projectId || !issueId) return;
			const issue = await gitlab.Issues.show(projectId, issueId);
			if (issue.state !== "closed") await t.setArchived(false);
		},
	};
}
