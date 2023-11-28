import { ApplicationCommandType, Client, Message, ContextMenuCommandBuilder } from "discord.js";

export const data = [new ContextMenuCommandBuilder().setType(ApplicationCommandType.Message).setName("Pin Message")];

const allowedGuilds = [
	// allowed in the whole guild
	"898925497508048896", // TTT
];

const allowedChannels = [
	// allowed in channel and all sub threads (forum posts)
	"1178083753801830482", // LoM Discussions
	"1078757609621962782", // DvZ Discussions
	"893307440551067648", // Sneakymouse Recipes
	"928544850691891221", // Wordle Bragging
];

export default function ThreadPins(client: Client) {
	client.on("interactionCreate", (interaction) => {
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
		if (allowedGuilds.includes(interaction.guildId)) allowed = true;
		if (allowedChannels.includes(interaction.channelId)) allowed = true;
		if (interaction.channel?.isThread() && allowedChannels.includes(interaction.channel.parentId || "")) allowed = true;

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
