import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { ApplicationCommand } from "discord.js/typings/index.js";
import { config } from "dotenv";
config();

enum GuildIds {
	TEST = "155020885521203200",
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
}

import { data as Vibecheck } from "./src/Vibecheck";
const commands = [Vibecheck.toJSON()];

const clientId = "713723936231129089";
const guildId = null; //GuildIds.TEST; //null

const rest = new REST({ version: "9" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
	try {
		console.log("Started refreshing application (/) commands.");

		if (guildId) await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
		else await rest.put(Routes.applicationCommands(clientId), { body: commands });

		console.log("Successfully reloaded application (/) commands.");
	} catch (error) {
		console.error(error);
	}
})();
