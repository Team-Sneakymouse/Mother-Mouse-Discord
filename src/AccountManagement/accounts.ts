import PocketBase, { ClientResponseError, RecordModel } from "pocketbase";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	ContainerBuilder,
	GuildMember,
	MessageActionRowComponentBuilder,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from "discord.js";
import { AccountRecord, UserRecord } from "./types.js";

export class AccountManagementInterface {
	static readonly TWITCH_REMOVE = "twitch_remove";
	static readonly TWITCH_ADD = "twitch_add";
	static readonly MINECRAFT_SETMAIN = "minecraft_setmain";
	static readonly MINECRAFT_REMOVE = "minecraft_remove";
	static readonly MINECRAFT_ADD = "minecraft_add";

	static async build(interaction: ChatInputCommandInteraction, db: PocketBase) {
		const userRecord = await db
			.collection("lom2_users")
			.getFirstListItem<UserRecord>(`discord_id="${interaction.user.id}"`)
			.catch(async (err: ClientResponseError) => {
				if (err.status === 404) {
					return await db.collection("lom2_users").create<UserRecord>({
						name: (interaction.member as GuildMember)?.displayName ?? interaction.user.username,
						discord_id: interaction.user.id,
						twitch: null, // Initialize with no Twitch account linked
					});
				}
				throw err; // Other errors should be thrown
			});

		const accountRecords = await db
			.collection("lom2_accounts")
			.getFullList<AccountRecord>({ filter: `owner.discord_id = "${interaction.user.id}"` });

		return [
			new TextDisplayBuilder().setContent("# Account Management\nUse this to manage your linked accounts"),
			...AccountManagementInterface.buildTwitchSection(userRecord.twitch),
			...AccountManagementInterface.buildMinecraftSection(accountRecords),
		];
	}

	static buildTwitchSection(twitch: UserRecord["twitch"]) {
		if (!twitch)
			return [
				new TextDisplayBuilder().setContent("## Twitch"),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(AccountManagementInterface.TWITCH_ADD)
						.setStyle(ButtonStyle.Success)
						.setLabel("Link Twitch Account")
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
						new ButtonBuilder()
							.setCustomId(`${AccountManagementInterface.TWITCH_REMOVE}:${twitch.id}`)
							.setStyle(ButtonStyle.Danger)
							.setLabel("Remove")
					)
				),
			new TextDisplayBuilder().setContent("-# You can only link a single Twitch account"),
		];
	}

	static buildMinecraftSection(accountRecords: AccountRecord[]) {
		return [
			new TextDisplayBuilder().setContent("## Minecraft"),
			...accountRecords.map((account) => AccountManagementInterface.buildMinecraftAccountSection(account)),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(AccountManagementInterface.MINECRAFT_ADD)
					.setStyle(ButtonStyle.Success)
					.setLabel(`Link ${accountRecords.length > 0 ? "new " : ""}Minecraft Account`)
			),
		];
	}
	static buildMinecraftAccountSection(account: AccountRecord) {
		return new ContainerBuilder()
			.setAccentColor(0x477a1e)
			.addSectionComponents(
				new SectionBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(`### ${account.name}`),
						new TextDisplayBuilder().setContent(account.main ? "Main Account" : "-# Alt Account")
					)
					.setThumbnailAccessory(
						new ThumbnailBuilder().setURL(`https://starlightskins.lunareclipse.studio/render/default/${account.id}/face`)
					)
			)
			.addActionRowComponents(
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(`${AccountManagementInterface.MINECRAFT_SETMAIN}:${account.id}`)
						.setStyle(ButtonStyle.Primary)
						.setLabel("Set as Main")
						.setDisabled(account.main),
					new ButtonBuilder()
						.setCustomId(`${AccountManagementInterface.MINECRAFT_REMOVE}:${account.id}`)
						.setStyle(ButtonStyle.Danger)
						.setLabel("Remove")
				)
			);
	}
}
