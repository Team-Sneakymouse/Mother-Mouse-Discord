import { Client } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
export const data = [new SlashCommandBuilder().setName("power").setDescription("Power up Dani")];

export default function OocPower(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "power") {
			const dani = interaction.guild?.members.cache.get("138345057072840704");
			if (!dani) {
				interaction.reply({
					content: "can't find dani",
					ephemeral: true,
				});
				return;
			}

			if (dani.roles.cache.has("971480595232342036")) {
				await dani.roles.remove("971480595232342036");
				interaction.reply({
					content: "Dani is no longer powered up",
					ephemeral: true,
				});
			} else {
				await dani.roles.add("971480595232342036");
				interaction.reply({
					content: "Powered up Dani",
					ephemeral: true,
				});
			}
		}
	});
}
