import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
export const data = [
	new SlashCommandBuilder()
		.setName("uuid")
		.setDescription("Get Minecraft UUID")
		.addStringOption(
			new SlashCommandStringOption().setName("username").setDescription("The username to get the UUID for").setRequired(true)
		),
];

export default function Uuid(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "uuid") {
			const username = interaction.options.getString("username", true);
			const res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);

			if (res.status === 204 || res.status === 404) {
				interaction.reply("User not found");
				return;
			}
			const data = (await res.json()) as { name: string; id: string };
			interaction.reply("```" + data.id + "```");
			return;
		}
	});
}
