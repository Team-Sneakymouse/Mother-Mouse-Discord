import { ContextMenuCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandType, Client, Message } from "discord.js";

const type: number = ApplicationCommandType.Message; //wtf
export const data = [new ContextMenuCommandBuilder().setType(type).setName("Pin Message")];

const allowedGuilds = [
	"898925497508048896", // TTT
];

const allowedThreads = [
	"893307440551067648", // Sneakymouse Recipes
	"928544850691891221", // Wordle Bragging
];

export default function ThreadPins(client: Client) {
	client.on("interactionCreate", (interaction) => {
		if (!interaction.isMessageContextMenuCommand()) return;
		if (interaction.commandName !== "Pin Message") return;

		if (!allowedGuilds.includes(interaction.guildId || "")) {
			if (!interaction.channel?.isThread()) {
				interaction.reply({
					content: "This command can only be used in specific threads.",
					ephemeral: true,
				});
				return;
			}

			if (!allowedThreads.includes(interaction.channelId)) {
				interaction.reply({
					content: "You are not allowed to pin messages in this thread. Please tell Dani if you would like to.",
					ephemeral: true,
				});
				return;
			}
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
