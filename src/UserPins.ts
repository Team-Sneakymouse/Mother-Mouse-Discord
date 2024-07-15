import { ApplicationCommandType, Client, Message, ContextMenuCommandBuilder } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

export const data = [new ContextMenuCommandBuilder().setType(ApplicationCommandType.Message).setName("Pin Message")];

const allowedGuilds = [
	// allowed in the whole guild
	"898925497508048896", // TTT
];

export default function ThreadPins(client: Client, db: PocketBase) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isMessageContextMenuCommand()) return;
		if (interaction.commandName !== "Pin Message") return;

		if (!interaction.guildId) {
			interaction.reply({
				content: "This command can only be used in a server.",
				ephemeral: true,
			});
			return;
		}

		let allowed = false;
		const allowedChannels = await db
			.collection("settings")
			.getFirstListItem<RecordModel & { value: string[] }>('key="discord_channels_user_pins"');
		if (!allowedChannels) {
			interaction.reply({
				content: "Failed looking up `discord_channels_user_pins`. Please tell Dani.",
				ephemeral: true,
			});
			return;
		}
		if (allowedGuilds.includes(interaction.guildId)) allowed = true;
		if (allowedChannels.value.includes(interaction.channelId)) allowed = true;
		if (interaction.channel?.isThread() && allowedChannels.value.includes(interaction.channel.parentId || "")) allowed = true;

		if (!allowed) {
			interaction.reply({
				content: "You don't have permission to use this command here. Please tell Dani if you would like to.",
				ephemeral: true,
			});
			return;
		}

		if (interaction.targetMessage.pinned) {
			(interaction.targetMessage as Message).unpin();
			interaction.reply({
				content: "Unpinning message",
			});
			return;
		} else {
			(interaction.targetMessage as Message).pin();
			interaction.reply({
				content: "Pinning message",
			});
			return;
		}
	});
}
