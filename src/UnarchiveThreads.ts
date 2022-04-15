import { ChannelType, Client } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import { projectIds, Projects } from "./Gitlab/utils";

export default function UnarchiveThreads(client: Client, gitlab: InstanceType<typeof Gitlab>) {
	client.on("threadUpdate", async (_, thread) => {
		if (thread.type !== ChannelType.GuildPublicThread) return;
		if (thread.ownerId !== client.user?.id) return;
		if (thread.archived === false) return;

		// Gitlab
		const starterMessage = await thread.fetchStarterMessage();
		const projectId = projectIds[thread.guildId as Projects];
		const issueId = parseInt(starterMessage.embeds[0].footer?.text.match(/\d+/)?.[0] as string);
		if (!projectId || !issueId) return;
		const issue = await gitlab.Issues.show(projectId, issueId);
		if (issue.state !== "closed") await thread.setArchived(false);
	});
}
