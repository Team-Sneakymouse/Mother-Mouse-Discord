import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { config } from "dotenv";
config();

enum GuildIds {
	TEST = "155020885521203200",
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
}

import { data as Vibecheck } from "./src/Vibecheck";
import { data as Roll } from "./src/Roll";
import { data as PalsRoles } from "./src/PalsRoles";
import { data as PronounRoles } from "./src/PronounRoles";
import { data as Todo } from "./src/Todo";
import { data as MoneyMilestone } from "./src/MoneyMilestone";
import { data as Answers } from "./src/Answers";
const commands = {
	global: [Vibecheck, Roll, Answers],
	[GuildIds.TEST]: [],
	[GuildIds.RAWBTV]: [PalsRoles, PronounRoles, MoneyMilestone],
	[GuildIds.TILII]: [Todo],
	[GuildIds.SNEAKYRP]: [],
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
