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
import { AccountStore, LinkAttempts } from "./store.js";
import { ButtonIds } from "./types.js";

type Components = JSONEncodable<APIMessageTopLevelComponent>[];

const TOKEN = /^[0-9]{5}$/;
const face = (uuid: string) => `https://starlightskins.lunareclipse.studio/render/default/${uuid}/face`;

export default class MinecraftLink {
	constructor(
		public customIds: ButtonIds,
		public store: AccountStore,
		private attempts = new LinkAttempts(),
	) {}
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
								.setMaxLength(5),
						),
					),
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
		const token = interaction.options.getString("token", false)?.trim();
		const components = token ? await this.collectLinkToken(interaction, token) : await this.createLinkToken(interaction);
		return await interaction.reply({
			flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
			components,
		});
	}
	async HandleModal(interaction: ModalSubmitInteraction) {
		if (!interaction.isFromMessage()) return;
		if (interaction.customId !== this.customIds.MINECRAFT_LINK_SUBMIT) return;
		const linkToken = interaction.fields.getTextInputValue(this.customIds.MINECRAFT_LINK_SUBMIT).trim();
		const components = await this.collectLinkToken(interaction, linkToken);
		await interaction.update({ components });
	}

	private backRow(...extra: ButtonBuilder[]) {
		return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
			...extra,
			new ButtonBuilder().setCustomId(this.customIds.ACCOUNT_MANAGEMENT).setStyle(ButtonStyle.Secondary).setLabel("Back to Account Management"),
		);
	}
	private retry(customId: string) {
		return new ButtonBuilder().setCustomId(customId).setStyle(ButtonStyle.Success).setLabel("Try Again");
	}
	private message(text: string, ...extra: ButtonBuilder[]): Components {
		return [new TextDisplayBuilder().setContent(text), this.backRow(...extra)];
	}
	private user(interaction: Interaction) {
		return this.store.userForDiscord(interaction.user.id, (interaction.member as GuildMember)?.displayName ?? interaction.user.username);
	}

	/** Runs `work` unless this Discord user already has a link request running. */
	private async exclusive(interaction: Interaction, work: () => Promise<Components>): Promise<Components> {
		if (this.inFlight.has(interaction.user.id)) return this.message("You're already in the process of linking your account. Please wait.");
		this.inFlight.add(interaction.user.id);
		try {
			return await work();
		} catch (error) {
			console.error("AccountManagement: Minecraft linking failed:", error);
			return this.message("Something went wrong. Please tell Dani.");
		} finally {
			this.inFlight.delete(interaction.user.id);
		}
	}

	async createLinkToken(interaction: Interaction): Promise<Components> {
		return this.exclusive(interaction, async () => {
			const token = await this.store.linkTokenForUser(await this.user(interaction));
			return this.message(`In Minecraft, please run this command to link your account within 30 minutes:\`\`\`/link ${token}\`\`\``);
		});
	}

	async collectLinkToken(interaction: Interaction, linkToken: string): Promise<Components> {
		if (!TOKEN.test(linkToken))
			return this.message("Invalid link token. Please make sure you entered a 5-digit token.", this.retry(this.customIds.MINECRAFT_LINK_MODAL));
		if (this.attempts.blocked(interaction.user.id)) return this.message("Too many wrong link tokens. Please wait a few minutes.");
		return this.exclusive(interaction, async () => {
			const result = await this.store.redeemForUser(linkToken, await this.user(interaction));
			switch (result.status) {
				case "ok":
					return [
						new TextDisplayBuilder().setContent(`Minecraft account **${result.account!.name}** linked successfully.`),
						new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(face(result.account!.uuid))),
						this.backRow(),
					];
				case "wrong_side":
					return this.message(`Please run this command **IN MINECRAFT** to link your account:\`\`\`/link ${linkToken}\`\`\``);
				case "other_owner":
					this.attempts.failed(interaction.user.id);
					return this.message("This token is meant for another user's Minecraft account. What are you trying to pull?");
				case "already_linked":
					return this.message("This Minecraft account is already linked to a Discord account.");
				default:
					this.attempts.failed(interaction.user.id);
					return this.message("Invalid or expired link token.", this.retry(this.customIds.MINECRAFT_LINK_MODAL));
			}
		});
	}

	async removeMinecraftAccount(interaction: Interaction, accountUuid: string): Promise<Components> {
		return this.exclusive(interaction, async () => {
			const result = await this.store.unlink(await this.user(interaction), accountUuid);
			if (result.status !== "ok") return this.message("You don't have this Minecraft account linked.");
			return this.message(
				`Minecraft account **${result.accountName}** removed successfully.${result.newMain ? `\nYour new main account is **${result.newMain.name}**.` : ""}`,
			);
		});
	}

	async setMainAccount(interaction: Interaction, accountUuid: string): Promise<Components> {
		return this.exclusive(interaction, async () => {
			const user = await this.user(interaction);
			const status = await this.store.setMain(user, accountUuid);
			if (status === "already_main") return this.message("This account is already set as your main account.");
			if (status !== "ok") return this.message("You don't have this Minecraft account linked.");
			const account = (await this.store.accounts(user)).find((a) => a.uuid === accountUuid);
			return [
				new TextDisplayBuilder().setContent(`**${account?.name ?? "This account"}** is now set as your main Minecraft account.`),
				new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(face(accountUuid))),
				this.backRow(),
			];
		});
	}
}
