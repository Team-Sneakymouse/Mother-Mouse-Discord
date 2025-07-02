import PocketBase, { ClientResponseError, RecordModel } from "pocketbase";
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
import { AccountRecord, ButtonIds, UserRecord } from "./types.js";

export class AccountManagementInterface {
	constructor(public customIds: ButtonIds, public db: PocketBase) {}

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
		const userRecord = await this.db
			.collection("lom2_users")
			.getFirstListItem<UserRecord>(`discord_id="${interaction.user.id}"`)
			.catch(async (err: ClientResponseError) => {
				if (err.status === 404) {
					return await this.db.collection("lom2_users").create<UserRecord>({
						name: (interaction.member as GuildMember)?.displayName ?? interaction.user.username,
						discord_id: interaction.user.id,
						twitch: null, // Initialize with no Twitch account linked
					});
				}
				throw err; // Other errors should be thrown
			});

		const accountRecords = await this.db
			.collection("lom2_accounts")
			.getFullList<AccountRecord>({ filter: `owner.discord_id = "${interaction.user.id}"` });

		return [
			new TextDisplayBuilder().setContent("# Account Management\nUse this to manage your linked accounts"),
			...this.buildTwitchSection(userRecord.twitch),
			...this.buildMinecraftSection(accountRecords, selectedAccount),
		];
	}

	buildTwitchSection(twitch: UserRecord["twitch"]) {
		if (!twitch)
			return [
				new TextDisplayBuilder().setContent("## Twitch"),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder().setCustomId(this.customIds.TWITCH_ADD).setStyle(ButtonStyle.Success).setLabel("Link Twitch Account")
				),
			];
		return [
			new TextDisplayBuilder().setContent("## Twitch"),
			new ContainerBuilder()
				.setAccentColor(0x6441a5)
				.addSectionComponents(
					new SectionBuilder()
						.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${twitch.display_name}`))
						.setThumbnailAccessory(
							new ThumbnailBuilder().setURL(
								twitch.profile_image_url ||
									"https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4cd9-adac-2f30151b4209-profile_image-70x70.png"
							)
						)
				)
				.addActionRowComponents(
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setCustomId(this.customIds.TWITCH_REMOVE).setStyle(ButtonStyle.Danger).setLabel("Remove")
					)
				),
			new TextDisplayBuilder().setContent("-# You can only link a single Twitch account"),
		];
	}

	buildMinecraftSection(accountRecords: AccountRecord[], selected: string | null = null) {
		// Sort accounts to show the main account first, then by creation date
		accountRecords.sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || a.created - b.created);

		if (selected === null && accountRecords.length > 0) {
			selected = accountRecords.find((a) => a.main)?.id ?? accountRecords[0].id;
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
											value: account.id,
											label: account.name,
											description: account.main ? "Main Account" : undefined,
											default: account.id === selected,
										})
								)
							)
						),
						this.buildMinecraftAccountSection(
							accountRecords.find((a) => a.id === selected) ?? accountRecords.find((a) => a.main) ?? accountRecords[0],
							true
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
					.setLabel("Enter Link Token")
			),
		];
	}
	buildMinecraftAccountSection(account: AccountRecord, showMain = false) {
		return new ContainerBuilder()
			.setAccentColor(0x477a1e)
			.addSectionComponents(
				new SectionBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`### ${account.name}`),
						...(showMain ? [new TextDisplayBuilder().setContent(account.main ? "Main Account" : "-# Alt Account")] : [])
					)
					.setThumbnailAccessory(
						new ThumbnailBuilder().setURL(`https://starlightskins.lunareclipse.studio/render/default/${account.id}/face`)
					)
			)
			.addActionRowComponents(
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(`${this.customIds.MINECRAFT_SETMAIN}:${account.id}`)
						.setStyle(ButtonStyle.Primary)
						.setLabel("Set as Main")
						.setDisabled(account.main),
					new ButtonBuilder()
						.setCustomId(`${this.customIds.MINECRAFT_REMOVE}:${account.id}`)
						.setStyle(ButtonStyle.Danger)
						.setLabel("Remove")
				)
			);
	}
}
