import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { config } from "dotenv";
config();

enum GuildIds {
	TEST = "155020885521203200",
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
	OOC = "971479608664924202",
	TURTLES = "898925497508048896",
}

import { data as Vibecheck } from "./src/Vibecheck";
import { data as RenameVC } from "./src/RenameVC";
import { data as tfcSolver } from "./src/tfcSolver";
import { data as Roll } from "./src/Roll";
import { data as PalsRoles } from "./src/PalsRoles";
import { data as PronounRoles } from "./src/PronounRoles";
//import { data as Todo } from "./src/Todo";
//import { data as MoneyMilestone } from "./src/MoneyMilestone";
import { data as Trivia } from "./src/Trivia";
import { data as UserPins } from "./src/UserPins";
import { data as GitlabIssues } from "./src/GitlabIssues";
import { data as OocTools } from "./src/OocTools";
import { data as SneakyrpPlayerlist } from "./src/SneakyrpPlayerlist";
import { data as TwitterFix } from "./src/TwitterFix";

const commands = {
	global: [...Vibecheck, ...Roll, ...TwitterFix],
	[GuildIds.TEST]: [],
	[GuildIds.RAWBTV]: [...PalsRoles, ...PronounRoles, ...Trivia, ...UserPins],
	[GuildIds.TILII]: [...GitlabIssues],
	[GuildIds.SNEAKYRP]: [...SneakyrpPlayerlist],
	[GuildIds.OOC]: [...OocTools],
	[GuildIds.TURTLES]: [...PalsRoles, ...PronounRoles, ...SneakyrpPlayerlist, ...RenameVC, ...UserPins, ...tfcSolver],
};

const clientId = process.env.DISCORD_CLIENTID!;
const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
	try {
		console.log("Started refreshing application (/) commands.");

		for (const [guildId, guildCommands] of Object.entries(commands)) {
			console.log(`Refreshing application commands for ${guildId}`);
			try {
				if (guildId === "global") {
					await rest.put(Routes.applicationCommands(clientId), { body: guildCommands });
				} else {
					await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCommands });
				}
			} catch (err) {
				if ((err as any).code !== 50001) throw err;
				console.error("Missing permission for " + guildId);
			}
		}

		console.log("Successfully reloaded application (/) commands.");
	} catch (error) {
		console.error(error);
	}
})();
