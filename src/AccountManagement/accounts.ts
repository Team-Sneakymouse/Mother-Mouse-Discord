import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	ContainerBuilder,
	GuildMember,
	Interaction,
	MessageActionRowComponentBuilder,
	SectionBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	StringSelectMenuOptionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import { AccountStore, MinecraftAccount, TwitchIdentity } from "./store.js";
import { ButtonIds } from "./types.js";

export class AccountManagementInterface {
	constructor(
		public customIds: ButtonIds,
		public store: AccountStore,
	) {}

	async HandleButton(interaction: ButtonInteraction) {
		if (interaction.customId === this.customIds.ACCOUNT_MANAGEMENT) {
			interaction.update({
				components: await this.buildInterface(interaction),
			});
		}
	}
	async HandleSelectMenu(interaction: StringSelectMenuInteraction) {
		if (interaction.customId === this.customIds.ACCOUNT_MINECRAFT_SELECT) {
			const selectedAccount = interaction.values[0];
			interaction.update({
				components: await this.buildInterface(interaction, selectedAccount),
			});
		}
	}

	async buildInterface(interaction: Interaction, selectedAccount: string | null = null) {
		const user = await this.store.userForDiscord(interaction.user.id, (interaction.member as GuildMember)?.displayName ?? interaction.user.username);
		const [twitch, accounts] = await Promise.all([this.store.twitch(user), this.store.accounts(user)]);

		return [
			new TextDisplayBuilder().setContent("# Account Management\nUse this to manage your linked accounts"),
			...this.buildTwitchSection(twitch),
			...this.buildMinecraftSection(accounts, selectedAccount),
		];
	}

	buildTwitchSection(twitch: TwitchIdentity | null) {
		if (!twitch)
			return [
				new TextDisplayBuilder().setContent("## Twitch"),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder().setCustomId(this.customIds.TWITCH_ADD).setStyle(ButtonStyle.Success).setLabel("Link Twitch Account"),
				),
			];
		return [
			new TextDisplayBuilder().setContent("## Twitch"),
			new ContainerBuilder()
				.setAccentColor(0x6441a5)
				.addSectionComponents(
					new SectionBuilder()
						.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${twitch.displayName}`))
						.setThumbnailAccessory(
							new ThumbnailBuilder().setURL(
								twitch.profileImageUrl || "https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4cd9-adac-2f30151b4209-profile_image-70x70.png",
							),
						),
				)
				.addActionRowComponents(
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setCustomId(this.customIds.TWITCH_REMOVE).setStyle(ButtonStyle.Danger).setLabel("Remove"),
					),
				),
			new TextDisplayBuilder().setContent("-# You can only link a single Twitch account"),
		];
	}

	buildMinecraftSection(accountRecords: MinecraftAccount[], selected: string | null = null) {
		// The store lists the main account first, then the oldest
		if (selected === null && accountRecords.length > 0) {
			selected = accountRecords.find((a) => a.isMain)?.uuid ?? accountRecords[0].uuid;
		}
		return [
			new TextDisplayBuilder().setContent("## Minecraft"),
			...(accountRecords.length <= 3
				? accountRecords.map((account) => this.buildMinecraftAccountSection(account, accountRecords.length > 1))
				: [
						new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
							new StringSelectMenuBuilder().setCustomId(this.customIds.ACCOUNT_MINECRAFT_SELECT).addOptions(
								accountRecords.map(
									(account) =>
										new StringSelectMenuOptionBuilder({
											value: account.uuid,
											label: account.name,
											description: account.isMain ? "Main Account" : undefined,
											default: account.uuid === selected,
										}),
								),
							),
						),
						this.buildMinecraftAccountSection(
							accountRecords.find((a) => a.uuid === selected) ?? accountRecords.find((a) => a.isMain) ?? accountRecords[0],
							true,
						),
					]),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(this.customIds.MINECRAFT_ADD)
					.setStyle(ButtonStyle.Success)
					.setLabel(`Link ${accountRecords.length > 0 ? "new " : ""}Minecraft Account`),
				new ButtonBuilder() // Modal to enter link token
					.setCustomId(this.customIds.MINECRAFT_LINK_MODAL)
					.setStyle(ButtonStyle.Secondary)
					.setLabel("Enter Link Token"),
			),
		];
	}
	buildMinecraftAccountSection(account: MinecraftAccount, showMain = false) {
		return new ContainerBuilder()
			.setAccentColor(0x477a1e)
			.addSectionComponents(
				new SectionBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`### ${account.name}`),
						...(showMain ? [new TextDisplayBuilder().setContent(account.isMain ? "Main Account" : "-# Alt Account")] : []),
					)
					.setThumbnailAccessory(new ThumbnailBuilder().setURL(`https://starlightskins.lunareclipse.studio/render/default/${account.uuid}/face`)),
			)
			.addActionRowComponents(
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(`${this.customIds.MINECRAFT_SETMAIN}:${account.uuid}`)
						.setStyle(ButtonStyle.Primary)
						.setLabel("Set as Main")
						.setDisabled(account.isMain),
					new ButtonBuilder().setCustomId(`${this.customIds.MINECRAFT_REMOVE}:${account.uuid}`).setStyle(ButtonStyle.Danger).setLabel("Remove"),
				),
			);
	}
}
