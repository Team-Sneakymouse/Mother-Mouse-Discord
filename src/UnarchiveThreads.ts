import { ChannelType, Client } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import PocketBase, { RecordModel } from "pocketbase";
import { channelIds, projectIds, Projects } from "./GitlabIssues/utils.js";

const hardCodedThreads = [
	"979858513180377108", // Daily wordle and other daily games
	"1001935183072743504", // 😓 - Complaining about jobs
	"997600089939902504", // Mana's Aquarium Trip
	"998062739085873182", // Dieting
	"975837301680767087", // recipes
	"987002461422227556", // ADHD Things 2 Electric Boogaloo
	"987408505399046186", // PTSD, C-PTSD, BPD, DID, and other trauma disorders support thread
	"994090193533542522", // Physical Disabilities Support Thread
	"988944471246917642", // 💪-exercise
	"999510277865357433", // 💥-Comic Books
	"981640103313154048", // 🐈-Cats Special Interest Thread
	"980846785440411699", // 🌌-astronomy
	"980846699964674068", // 🍀-drugs
	"976231495184289842", // spamton g spamton
	"980989057138049075", // 🌈 - musicals
	"980848886509891614", // 🐱-internet-videos
	"980848143052705842", // 🎤-podcasts
	"980848265765453824", // 🎵-music
	"980848802107887736", // 🎬-movies-and-tv
	"981002986262257734", // Chuckle Chums (working title for puppet pals community remaster)
	"981678740289515531", // 🧾-kinklists
	"980843430735380501", // 🧶-bdsm-and-ropes
	"990239687937507398", // 🍻-deep rock
	"980845016169709620", // 🔫-gmod
	"980844948557557781", // 🐤-pokemon
	"980844557652611092", // 🌲🤛-minecraft
	"980844874372894730", // 🏭-factorio
	"975967966506156082", // 🧗-Breath Of The Wild
];

export default function UnarchiveThreads(client: Client, db: PocketBase, gitlab: InstanceType<typeof Gitlab>) {
	client.on("threadUpdate", async (_, thread) => {
		if (thread.archived === false) return;

		if (hardCodedThreads.includes(thread.id)) {
			console.log(`unarchiving thread ${thread.guild.name}/${thread.name}`);
			await thread.setArchived(false);
			return;
		}

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

		if (!thread.locked) {
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
