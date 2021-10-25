import { Client } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
export const data = new SlashCommandBuilder().setName("vibecheck").setDescription("Check the vibe");

export default function Vibecheck(client: Client) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isCommand() && interaction.commandName === "vibecheck") {
			return interaction.reply(`We vibin' <:1robMyMan:805582449022337024>`);
		}
	});
}
