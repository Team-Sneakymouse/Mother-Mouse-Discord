import { ChannelType, Client, ThreadAutoArchiveDuration } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import PocketBase, { RecordModel } from "pocketbase";
import { channelIds, projectIds, Projects } from "./GitlabIssues/utils.js";

export default function UnarchiveThreads(client: Client, db: PocketBase, gitlab: InstanceType<typeof Gitlab>) {
	client.on("threadUpdate", async (_, thread) => {
		if (thread.archived === false && thread.locked === false) return;

		// SneakyRP Applications
		if (thread.parentId === "963808503808557127") {
			const starterMessage = await thread.fetchStarterMessage();
			if (starterMessage && starterMessage.components !== undefined && starterMessage.components.length > 0) {
				console.log(`unarchiving thread ${thread.guild.name}/${thread.name}`);
				await thread.setArchived(false);
				return;
			}
		}

		// Gitlab
		// if (starterMessage && Object.keys(channelIds).includes(starterMessage.channelId)) {
		// 	const projectId = projectIds[thread.guildId as Projects];
		// 	const issueId = parseInt(starterMessage.embeds[0].footer?.text.match(/\d+/)?.[0] as string);
		// 	if (!projectId || !issueId) {
		// 		try {
		// 			const issue = await gitlab.Issues.show(projectId, issueId);
		// 			if (issue) {
		// 				if (issue.state !== "closed") {
		// 					console.log(`unarchiving thread ${thread.guild.name}/${thread.name}`);
		// 					await thread.setArchived(false);
		// 				}
		// 				return;
		// 			}
		// 		} catch (e) {
		// 			console.error(`Error in fetching gitlab issue ${projectId}, ${issueId}. Is it just missing?`, e);
		// 		}
		// 	}
		// }

		// Unlock public forums
		const forums = [
			"1249536990253154356", // wiki cooridnation
			"1187395188293894154", // lom screenshots
			"1178083753801830482", // lom discussion
			"1254164634630361209", // build server
			"1127728447360348311", // dvz screenshots
			"1078757609621962782", // dvz discussion
			"1153431952058241034", // games
		];
		if (thread.locked && thread.parentId && forums.includes(thread.parentId)) {
			if (thread.autoArchiveDuration && thread.autoArchiveDuration <= ThreadAutoArchiveDuration.OneHour) return;
			console.log(`unlocking thread ${thread.guild.name}/${thread.name}`);
			if (thread.archived) await thread.setArchived(false);
			thread.setLocked(false);
			return;
		}

		// Prevent auto-archive
		if (!thread.locked && thread.archived) {
			if (thread.autoArchiveDuration && thread.autoArchiveDuration <= ThreadAutoArchiveDuration.OneHour) return;
			const ids = await db
				.collection("settings")
				.getFirstListItem<RecordModel & { value: string[] }>('key="discord_threads_no_autoclose"');
			const hasThread = ids && ids.value.includes(thread.id);
			const hasParent = thread.parentId && ids && ids.value.includes(thread.parentId);
			if (hasThread || hasParent) {
				console.log(`unarchiving thread ${thread.guild.name}/${thread.name}`);
				await thread.setArchived(false);
			}
		}
	});
}
