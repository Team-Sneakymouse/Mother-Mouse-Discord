#! node_modules/.bin/ts-node-esm
import { REST, Routes } from "discord.js";
import { config } from "dotenv";
config();

enum GuildIds {
	TEST = "155020885521203200",
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
	OOC = "971479608664924202",
	TURTLES = "898925497508048896",
	MSD = "787222656926744586",
}

import { data as Vibecheck } from "./src/Vibecheck.js";
import { data as RenameVC } from "./src/RenameVC.js";
import { data as tfcSolver } from "./src/tfcSolver.js";
import { data as Roll } from "./src/Roll.js";
import { data as PalsRoles } from "./src/PalsRoles.js";
import { data as PronounRoles } from "./src/PronounRoles.js";
//import { data as Todo } from "./src/Todo.js";
//import { data as MoneyMilestone } from "./src/MoneyMilestone.js";
import { data as Trivia } from "./src/Trivia.js";
import { data as UserPins } from "./src/UserPins.js";
import { data as GitlabIssues } from "./src/GitlabIssues/index.js";
import { data as OocTools } from "./src/OocTools.js";
import { data as SneakyrpPlayerlist } from "./src/SneakyrpPlayerlist.js";
import { data as TwitterFix } from "./src/TwitterFix.js";
import { data as MinecraftDvzRegistrations } from "./src/MinecraftDvzRegistrations.js";
import { data as Faq } from "./src/Faq.js";
import { data as Uuid } from "./src/Uuid.js";
import { data as MinecraftWhitelist } from "./src/MinecraftWhitelist.js";
import { metadata as RoleConnectionMetadata } from "./src/LinkedRole.js";
import { data as YouTube } from "./src/YouTube.js";

const commands = {
	global: [...Vibecheck, ...Roll, ...TwitterFix, ...Uuid],
	[GuildIds.TEST]: [],
	[GuildIds.RAWBTV]: [...PalsRoles, ...PronounRoles, ...Trivia, ...UserPins, ...MinecraftDvzRegistrations, ...Faq],
	[GuildIds.TILII]: [...GitlabIssues],
	[GuildIds.SNEAKYRP]: [...SneakyrpPlayerlist],
	[GuildIds.OOC]: [...OocTools, ...YouTube],
	[GuildIds.TURTLES]: [...PalsRoles, ...PronounRoles, ...SneakyrpPlayerlist, ...RenameVC, ...UserPins, ...tfcSolver],
	[GuildIds.MSD]: [...MinecraftWhitelist],
};

const roleConnectionMetadata = RoleConnectionMetadata;

const clientId = process.env.DISCORD_CLIENTID!;
const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

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

		await rest.put(Routes.applicationRoleConnectionMetadata(clientId), { body: roleConnectionMetadata });

		console.log("Successfully reloaded application role connection metadata.");
	} catch (error) {
		console.error(error);
	}
})();
