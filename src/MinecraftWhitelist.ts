import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import PocketBase from "pocketbase";
import MulticraftAPI from "./utils/multicraft.js";
export const data = [
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link Minecraft account")
		.addStringOption(new SlashCommandStringOption().setName("username").setDescription("Minecraft username").setRequired(true)),
];

export default function MinecraftWhitelist(client: Client, db: PocketBase, multicraft: MulticraftAPI) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "link") {
			const username = interaction.options.getString("username", true);
			const res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);
			if (res.status === 204) {
				// No content
				interaction.reply({
					content: "",
					embeds: [
						{
							title: "Error",
							description: `Minecraft account \`${username}\` does not exist.`,
							color: 0xa01a04,
						},
					],
				});
				return;
			} else if (res.status !== 200) {
				// Other error
				console.error("Mojang API error", res.status, res.statusText, await res.text());
				await interaction.reply({
					content: "",
					embeds: [
						{
							title: "Error",
							description: "An error occurred while communicating with Mojang's API.",
							color: 0xa01a04,
						},
					],
				});
				return;
			} else {
				// Success
				const { name, id } = (await res.json()) as { name: string; id: string };
				const commandResponse = await multicraft.call("sendConsoleCommand", { server_id: 14, command: `whitelist add ${name}` });
				if (!commandResponse.success) {
					await interaction.reply({
						content: "",
						embeds: [
							{
								title: "Error",
								description: "An error occurred while adding the account to the whitelist.",
								color: 0xa01a04,
							},
						],
					});
					console.error("Multicraft error", JSON.stringify(commandResponse.errors, null, 2));
					return;
				}

				const user = await db
					.collection("dvz_users")
					.getFirstListItem<{ discordId: string; uuid: string }>(`discordId="${interaction.user.id}" || uuid="${id}"`)
					.catch(() => null);
				if (user) {
					let description = "";
					if (user.discordId === interaction.user.id) {
						description = `You have already linked the Minecraft account \`${name}\`.`;
					} else {
						description = `Minecraft account \`${name}\` is already linked to another Discord account.`;
					}

					await interaction.reply({
						content: "",
						embeds: [
							{
								title: "Error",
								description: description,
								color: 0xa01a04,
							},
						],
					});
					return;
				}
				await db.collection("dvz_users").create({ discordId: interaction.user.id, uuid: id });

				await interaction.reply({
					content: "",
					embeds: [
						{
							title: "Success",
							description: `Minecraft account \`${name}\` linked to Discord account <@${interaction.user.id}>.`,
							color: 0x4db924,
							image: {
								url: `https://crafatar.com/renders/body/${id}?overlay`,
							},
						},
					],
				});
				return;
			}
		}
	});
}
