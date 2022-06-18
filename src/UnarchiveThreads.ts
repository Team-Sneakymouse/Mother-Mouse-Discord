import { ChannelType, Client } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import { channelIds, projectIds, Projects } from "./GitlabIssues/utils";

const hardCodedThreads = [
	"987002461422227556", // TTT ADHD
];

export default function UnarchiveThreads(client: Client, gitlab: InstanceType<typeof Gitlab>) {
	client.on("threadUpdate", async (_, thread) => {
		if (thread.type !== ChannelType.GuildPublicThread) return;
		if (thread.ownerId !== client.user?.id) return;
		if (thread.archived === false) return;

		if (hardCodedThreads.includes(thread.id)) {
			await thread.setArchived(false);
			return;
		}

		const starterMessage = await thread.fetchStarterMessage();

		// Gitlab
		if (Object.keys(channelIds).includes(starterMessage.channelId)) {
			const projectId = projectIds[thread.guildId as Projects];
			const issueId = parseInt(starterMessage.embeds[0].footer?.text.match(/\d+/)?.[0] as string);
			if (!projectId || !issueId) {
				try {
					const issue = await gitlab.Issues.show(projectId, issueId);
					if (issue) {
						if (issue.state !== "closed") await thread.setArchived(false);
						return;
					}
				} catch (e) {
					console.error(`Error in fetching gitlab issue ${projectId}, ${issueId}. Is it just missing?`, e);
				}
			}
		}

		// SneakyRP Applications
		if (starterMessage.channelId === "963808503808557127") {
			if (starterMessage.components !== undefined && starterMessage.components.length > 0) {
				await thread.setArchived(false);
				return;
			}
		}
	});
}
