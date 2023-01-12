import { Client, SlashCommandBuilder } from "discord.js";
export const data = [new SlashCommandBuilder().setName("vibecheck").setDescription("Check the vibe")];

export default function Vibecheck(client: Client) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "vibecheck") {
			interaction.reply(`We vibin' <:1robMyMan:805582449022337024>`);
			return;
		}
	});
}
