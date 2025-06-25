import {
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	Client,
	GuildMember,
	InteractionType,
	MessageFlagsBitField,
	SectionBuilder,
	SlashCommandBuilder,
	SlashCommandStringOption,
	TextDisplayBuilder,
} from "discord.js";
import PocketBase, { ClientResponseError, RecordModel } from "pocketbase";
import type { Express } from "express";
import { AccountManagementInterface } from "./accounts.js";

export const data = [
	new SlashCommandBuilder()
		.setName("accounts") //
		.setDescription("Manage your linked accounts"),
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Minecraft account to your Discord account")
		.addStringOption(new SlashCommandStringOption().setName("token").setDescription("Link token from Minecraft").setRequired(false))
		.addStringOption(
			new SlashCommandStringOption()
				.setName("platform")
				.setDescription("Select platform to link")
				.setChoices({ name: "Minecraft", value: "minecraft" }, { name: "Twitch", value: "twitch" })
				.setRequired(false)
		),
];

export default function AccountManagement(client: Client, db: PocketBase, server: Express) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand()) {
			switch (interaction.commandName) {
				case "accounts": {
					interaction.reply({
						flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
						components: await AccountManagementInterface.build(interaction, db),
					});
					return;
				}
			}
		}
	});
}
