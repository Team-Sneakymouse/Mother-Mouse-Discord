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
import TwitchLink from "./twitchLink.js";
import { ButtonIds } from "./types.js";
import MinecraftLink from "./minecraftLink.js";

const accountsAliases = ["account", "accounts", "authenticate", "howtoauthenticate"];
export const data = [
	...accountsAliases.map((alias) =>
		new SlashCommandBuilder()
			.setName(alias) //
			.setDescription("Manage your linked accounts")
	),
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Minecraft account to your Discord account")
		.addStringOption(new SlashCommandStringOption().setName("token").setDescription("Link token from Minecraft").setRequired(false)),
];

export default function AccountManagement(client: Client, db: PocketBase, server: Express) {
	const buttonIds: ButtonIds = {
		ACCOUNT_MANAGEMENT: "account_management",
		ACCOUNT_MINECRAFT_SELECT: "account_minecraft_select",
		TWITCH_REMOVE: "twitch_remove",
		TWITCH_ADD: "twitch_add",
		MINECRAFT_SETMAIN: "minecraft_setmain",
		MINECRAFT_REMOVE: "minecraft_remove",
		MINECRAFT_ADD: "minecraft_add",
		MINECRAFT_LINK_MODAL: "minecraft_link_modal",
		MINECRAFT_LINK_SUBMIT: "minecraft_link_submit",
	};
	const accountManagement = new AccountManagementInterface(buttonIds, db);
	const twitchLink = new TwitchLink(buttonIds, db, server);
	const minecraftLink = new MinecraftLink(buttonIds, db);

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand()) {
			switch (interaction.commandName) {
				case "link": {
					await minecraftLink.HandleCommand(interaction);
					return;
				}
				default: {
					if (!accountsAliases.includes(interaction.commandName)) return;
					await interaction.reply({
						flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
						components: await accountManagement.buildInterface(interaction),
					});
					return;
				}
			}
		} else if (interaction.isButton()) {
			await Promise.all([accountManagement.HandleButton(interaction), twitchLink.HandleButton(interaction), minecraftLink.HandleButton(interaction)]);
		} else if (interaction.isModalSubmit()) {
			await minecraftLink.HandleModal(interaction);
		} else if (interaction.isStringSelectMenu()) {
			await accountManagement.HandleSelectMenu(interaction);
		}
	});
}
