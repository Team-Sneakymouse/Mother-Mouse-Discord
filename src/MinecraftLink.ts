import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
import MulticraftAPI from "./utils/multicraft.js";
export const data = [
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Minecraft account to your Discord account")
		.addStringOption(new SlashCommandStringOption().setName("token").setDescription("Link token from Minecraft").setRequired(false)),
];

type LinkRecord = RecordModel & {
	discord_id: string;
	minecraft_uuid: string;
	link_token: string;
};

export default function DvzRegistrations(client: Client, db: PocketBase) {
	const inFlight = new Set<string>();

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "link") {
			if (inFlight.has(interaction.user.id)) {
				await interaction.reply({
					content: "You're already in the process of linking your account. Please wait.",
					ephemeral: true,
				});
				return;
			}
			inFlight.add(interaction.user.id);

			const code = interaction.options.getString("code", false);
			if (!code) {
				let token = "";
				for (let i = 0; i < 6; i++) {
					const testToken = (Math.floor(Math.random() * 90000) + 10000).toString();
					const tokenCheckRecord = await db
						.collection("minecraft_link")
						.getFirstListItem<LinkRecord>(`link_token = "${testToken}"`)
						.catch(() => null);
					if (!tokenCheckRecord) {
						token = testToken;
						break;
					}
				}
				if (!token) {
					await interaction.reply({
						content: "Failed to generate link token. Please tell Dani.",
						ephemeral: true,
					});
					inFlight.delete(interaction.user.id);
					return;
				}

				const updateRecord = await db
					.collection("minecraft_link")
					.create<LinkRecord>({
						discord_id: interaction.user.id,
						link_token: token,
					})
					.catch(() => null);
				if (!updateRecord) {
					await interaction.reply({
						content: "Failed to save link record. Please tell Dani.",
						ephemeral: true,
					});
					inFlight.delete(interaction.user.id);
					return;
				}

				await interaction.reply({
					content: "In Minecraft, please run this command to link your account:```/link " + token + "```",
					ephemeral: true,
				});

				inFlight.delete(interaction.user.id);
				return;
			}

			const linkRecords = await db
				.collection("minecraft_link")
				.getList<LinkRecord>(1, 1, { filter: `link_token = "${code}"` })
				.catch(() => null);
			if (!linkRecords) {
				await interaction.reply({
					content: "Failed to check link token. Please tell Dani.",
					ephemeral: true,
				});
				inFlight.delete(interaction.user.id);
				return;
			}

			const record = linkRecords.items.at(0);
			if (!record) {
				await interaction.reply({
					content: "Invalid link code.",
					ephemeral: true,
				});
				inFlight.delete(interaction.user.id);
				return;
			}

			const updateRecord = await db
				.collection("minecraft_link")
				.update<LinkRecord>(record.id, {
					discord_id: interaction.user.id,
					link_token: "",
				})
				.catch(() => null);
			if (!updateRecord) {
				await interaction.reply({
					content: "Failed to save link record. Please tell Dani.",
					ephemeral: true,
				});
				inFlight.delete(interaction.user.id);
				return;
			}

			await interaction.reply({
				content: "Successfully linked your account.",
				ephemeral: true,
			});
		}
	});
}
