import {
	APIMessageTopLevelComponent,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ChatInputCommandInteraction,
	GuildMember,
	Interaction,
	JSONEncodable,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageActionRowComponentBuilder,
	MessageFlagsBitField,
	ModalActionRowComponentBuilder,
	ModalBuilder,
	ModalSubmitInteraction,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import PocketBase, { ClientResponseError } from "pocketbase";
import { AccountRecord, ButtonIds, LinkRecord, UserRecord } from "./types.js";

export default class MinecraftLink {
	constructor(public customIds: ButtonIds, public db: PocketBase) {}
	inFlight = new Set<string>();

	async HandleButton(interaction: ButtonInteraction) {
		if (interaction.customId === this.customIds.MINECRAFT_ADD)
			return interaction.update({
				components: await this.createLinkToken(interaction),
			});
		if (interaction.customId === this.customIds.MINECRAFT_LINK_MODAL)
			return await interaction.showModal(
				new ModalBuilder()
					.setCustomId(this.customIds.MINECRAFT_LINK_SUBMIT)
					.setTitle("Link Minecraft Account")
					.addComponents(
						new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
							new TextInputBuilder()
								.setCustomId(this.customIds.MINECRAFT_LINK_SUBMIT)
								.setLabel("Minecraft Link Token")
								.setPlaceholder("Enter your link token from Minecraft here")
								.setRequired(true)
								.setStyle(TextInputStyle.Short)
								.setMinLength(5)
								.setMaxLength(5)
						)
					)
			);
		if (interaction.customId.startsWith(this.customIds.MINECRAFT_REMOVE)) {
			const accountUuid = interaction.customId.split(":")[1];
			return interaction.update({
				components: await this.removeMinecraftAccount(interaction, accountUuid),
			});
		}
		if (interaction.customId.startsWith(this.customIds.MINECRAFT_SETMAIN)) {
			const accountUuid = interaction.customId.split(":")[1];
			return interaction.update({
				components: await this.setMainAccount(interaction, accountUuid),
			});
		}
	}
	async HandleCommand(interaction: ChatInputCommandInteraction) {
		if (interaction.commandName !== "link") return;
		const token = interaction.options.getString("token", false);
		if (token && token.length !== 5)
			return await interaction.reply({
				flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
				components: [
					new TextDisplayBuilder().setContent("Invalid link token. Please make sure you entered a 5-digit token."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				],
			});
		const components = token ? await this.collectLinkToken(interaction, token) : await this.createLinkToken(interaction);
		if (components)
			return await interaction.reply({
				flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
				components,
			});
	}
	async HandleModal(interaction: ModalSubmitInteraction) {
		if (!interaction.isFromMessage()) return;
		if (interaction.customId !== this.customIds.MINECRAFT_LINK_SUBMIT) return;
		const linkToken = interaction.fields.getTextInputValue(this.customIds.MINECRAFT_LINK_SUBMIT);
		const components = await this.collectLinkToken(interaction, linkToken);
		if (components) interaction.update({ components });
	}

	async createLinkToken(interaction: Interaction): Promise<JSONEncodable<APIMessageTopLevelComponent>[]> {
		if (this.inFlight.has(interaction.user.id))
			return [
				new TextDisplayBuilder().setContent("You're already in the process if linking your account. Please wait."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		this.inFlight.add(interaction.user.id);
		try {
			const userRecord = await this.getUserRecord(
				interaction.user.id,
				(interaction.member as GuildMember)?.displayName ?? interaction.user.username
			);

			// check if a token already exists
			const linkRecord = await this.db
				.collection("minecraft_link")
				.getFirstListItem<LinkRecord>(`user = "${userRecord.id}"`)
				.catch(() => null);
			if (linkRecord)
				return [
					new TextDisplayBuilder().setContent(
						"In Minecraft, please run this command to link your account:```/link " + linkRecord.link_token + "```"
					),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];

			// generate a new link token
			let token = "";
			for (let i = 0; i < 5; i++) {
				const testToken = (Math.floor(Math.random() * 90000) + 10000).toString();
				// Check for token collision
				const tokenCheckRecord = await this.db
					.collection("minecraft_link")
					.getFirstListItem<LinkRecord>(`link_token = "${testToken}"`)
					.catch(() => null);
				if (!tokenCheckRecord) {
					token = testToken;
					break;
				}
			}
			if (!token)
				return [
					new TextDisplayBuilder().setContent("Failed to generate a unique link token. Please tell Dani."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setCustomId(this.customIds.MINECRAFT_ADD).setStyle(ButtonStyle.Success).setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];

			// Save link record with token
			const createRecord = await this.db
				.collection("minecraft_link")
				.create<LinkRecord>({
					user: userRecord.id,
					link_token: token,
				})
				.catch(() => null);
			if (!createRecord)
				return [
					new TextDisplayBuilder().setContent("Failed to save link record. Please tell Dani."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setCustomId(this.customIds.MINECRAFT_ADD).setStyle(ButtonStyle.Success).setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			// Send token to user
			return [
				new TextDisplayBuilder().setContent("In Minecraft, please run this command to link your account:```/link " + token + "```"),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		} finally {
			this.inFlight.delete(interaction.user.id);
		}
	}
	async collectLinkToken(interaction: Interaction, linkToken: string): Promise<undefined | JSONEncodable<APIMessageTopLevelComponent>[]> {
		if (this.inFlight.has(interaction.user.id)) {
			return [
				new TextDisplayBuilder().setContent("You're already in the process of linking your account. Please wait."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		}
		this.inFlight.add(interaction.user.id);
		try {
			const userRecord = await this.getUserRecord(
				interaction.user.id,
				(interaction.member as GuildMember)?.displayName ?? interaction.user.username
			);

			if (linkToken.length !== 5) {
				return [
					new TextDisplayBuilder().setContent("Invalid link token. Please make sure you entered a 5-digit token."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
							.setStyle(ButtonStyle.Success)
							.setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}

			// Check if the token exists
			const linkRecord = await this.db
				.collection("minecraft_link")
				.getFirstListItem<LinkRecord<UserRecord>>(`link_token = "${linkToken}"`, { expand: "user" })
				.catch(() => null);
			if (!linkRecord) {
				return [
					new TextDisplayBuilder().setContent("Invalid link token."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
							.setStyle(ButtonStyle.Success)
							.setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}

			if (linkRecord.account === "") {
				const errorMessage =
					linkRecord.expand?.user && linkRecord.expand?.user.discord_id !== interaction.user.id
						? "This token is meant for another user's Minecraft account. What are you trying to pull?"
						: "Please run this command **IN MINECRAFT** to link your account:```/link " + linkToken + "```";
				return [
					new TextDisplayBuilder().setContent(errorMessage),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}

			// Check if user has other linked accounts
			const otherAccounts = await this.db
				.collection("lom2_accounts")
				.getFullList<AccountRecord>({ filter: `owner.id = "${userRecord.id}"` })
				.catch(() => null);
			if (!otherAccounts) {
				return [
					new TextDisplayBuilder().setContent("Failed to check linked accounts. Please tell Dani."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
							.setStyle(ButtonStyle.Success)
							.setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}
			const otherMain = otherAccounts.find((account) => account.main);

			// Link account to user
			const updateResult = await this.db
				.collection("lom2_accounts")
				.update<AccountRecord>(linkRecord.account, {
					owner: userRecord.id,
					main: !otherMain,
				})
				.catch(() => null);
			if (!updateResult) {
				return [
					new TextDisplayBuilder().setContent("Failed to link account. Please tell Dani."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
							.setStyle(ButtonStyle.Success)
							.setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}

			// Delete link record
			const deleteResult = await this.db
				.collection("minecraft_link")
				.delete(linkRecord.id)
				.catch(() => null);
			if (!deleteResult) {
				return [
					new TextDisplayBuilder().setContent("Failed to clean up. Please tell Dani."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
							.setStyle(ButtonStyle.Success)
							.setLabel("Try Again"),
						new ButtonBuilder()
							.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				];
			}
			return [
				new TextDisplayBuilder().setContent("Account linked successfully."),
				new MediaGalleryBuilder().addItems(
					new MediaGalleryItemBuilder().setURL(
						`https://starlightskins.lunareclipse.studio/render/default/${linkRecord.account}/face`
					)
				),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		} finally {
			this.inFlight.delete(interaction.user.id);
		}
	}
	async removeMinecraftAccount(interaction: Interaction, accountUuid: string) {
		const account = await this.db
			.collection("lom2_accounts")
			.getOne<AccountRecord<UserRecord>>(accountUuid, { expand: "owner" })
			.catch(() => null);
		if (!account || account.expand!.owner.discord_id !== interaction.user.id) {
			if (!account?.expand || !account.expand.owner) console.error("Couldn't expand account owner: ", account);
			return [
				new TextDisplayBuilder().setContent("You don't have this Minecraft account linked."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		}

		const removeAccount = await this.db
			.collection("lom2_accounts")
			.update<AccountRecord>(account.id, {
				owner: "",
				main: false, // Unset main status
				dvz: false, // Unset DvZ status
			})
			.catch(() => null);
		if (!removeAccount)
			return [
				new TextDisplayBuilder().setContent("Failed to remove account. Please tell Dani."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		let newMainAccount: AccountRecord | null = null;
		if (account.main) {
			// If this was the main account, set another account as main if available
			const otherAccounts = await this.db
				.collection("lom2_accounts")
				.getFullList<AccountRecord>({ filter: `owner.discord_id = "${interaction.user.id}"` })
				.catch(() => null);
			if (otherAccounts && otherAccounts.length > 0) {
				newMainAccount = otherAccounts[0]; // Just pick the first one as new main
				await this.db.collection("lom2_accounts").update<AccountRecord>(newMainAccount.id, { main: true });
			}
		}

		return [
			new TextDisplayBuilder().setContent(
				`Minecraft account **${account.name}** removed successfully.${
					newMainAccount ? `\nYour new main account is **${newMainAccount.name}**.` : ""
				}`
			),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
					.setStyle(ButtonStyle.Secondary)
					.setLabel("Back to Account Management")
			),
		];
	}
	async setMainAccount(interaction: Interaction, accountUuid: string) {
		const accounts = await this.db
			.collection("lom2_accounts")
			.getFullList<AccountRecord>({ filter: `owner.discord_id = "${interaction.user.id}"` });
		if (accounts.length === 0)
			return [
				new TextDisplayBuilder().setContent("You don't have any Minecraft accounts linked."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		const account = accounts.find((acc) => acc.id === accountUuid);
		if (!account)
			return [
				new TextDisplayBuilder().setContent("You don't have this Minecraft account linked."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		if (account.main)
			return [
				new TextDisplayBuilder().setContent("This account is already set as your main account."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		// Unset main status for all other accounts
		const updatePromises = accounts
			.filter((acc) => acc.uuid !== accountUuid && acc.main)
			.map((acc) => this.db.collection("lom2_accounts").update<AccountRecord>(acc.id, { main: false }));
		await Promise.all(updatePromises).catch(() => null);
		// Set this account as main
		const updateResult = await this.db
			.collection("lom2_accounts")
			.update<AccountRecord>(account.id, { main: true })
			.catch(() => null);
		if (!updateResult)
			return [
				new TextDisplayBuilder().setContent("Failed to set this account as main. Please tell Dani."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];
		return [
			new TextDisplayBuilder().setContent(`**${account.name}** is now set as your main Minecraft account.`),
			new MediaGalleryBuilder().addItems(
				new MediaGalleryItemBuilder().setURL(`https://starlightskins.lunareclipse.studio/render/default/${account.id}/face`)
			),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(this.customIds.ACCOUNT_MANAGEMENT)
					.setStyle(ButtonStyle.Secondary)
					.setLabel("Back to Account Management")
			),
		];
	}

	async getUserRecord(discordId: string, username: string): Promise<UserRecord> {
		try {
			return await this.db.collection("lom2_users").getFirstListItem<UserRecord>(`discord_id = "${discordId}"`);
		} catch (e) {
			if (e instanceof ClientResponseError && e.status === 404) {
				// Create user record if it doesn't exist
				return await this.db.collection("lom2_users").create<UserRecord>({
					discord_id: discordId,
					name: username,
				});
			}
			throw e; // Re-throw if it's not a 404 error
		}
	}
}
