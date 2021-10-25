import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { ApplicationCommand } from "discord.js/typings/index.js";
import { config } from "dotenv";
config();

const clientId = "713723936231129089";

enum GuildIds {
	TEST = "155020885521203200",
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
}

const commands = {
	global: [],
	[GuildIds.TEST]: [],
	[GuildIds.RAWBTV]: [],
	[GuildIds.TILII]: [],
	[GuildIds.SNEAKYRP]: [],
};

import { data as Vibecheck } from "./src/Vibecheck";
commands["global"].push(Vibecheck);

const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
	try {
		console.log("Started refreshing application (/) commands.");

		for (const [guildId, guildCommands] of Object.entries(commands)) {
			console.log(`Refreshing application commands for ${guildId}`);
			if (guildId === "global") {
				await rest.put(Routes.applicationCommands(clientId), { body: guildCommands });
			} else {
				await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildCommands });
			}
		}

		console.log("Successfully reloaded application (/) commands.");
	} catch (error) {
		console.error(error);
	}
})();
