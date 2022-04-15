import { ContextMenuCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandType, Client, Message } from "discord.js";

const type: number = ApplicationCommandType.Message; //wtf
export const data = [new ContextMenuCommandBuilder().setType(type).setName("Pin Message")];

const allowedThreads = [
	"893307440551067648", // Sneakymouse Recipes
	"928544850691891221", // Wordle Bragging
];

export default function ThreadPins(client: Client) {
	client.on("interactionCreate", (interaction) => {
		if (!interaction.isMessageContextMenuCommand()) return;
		if (interaction.commandName !== "Pin Message") return;

		if (!interaction.channel?.isThread())
			return interaction.reply({
				content: "This command can only be used in specific threads.",
				ephemeral: true,
			});

		if (!allowedThreads.includes(interaction.channelId))
			return interaction.reply({
				content: "You are not allowed to pin messages in this thread. Please tell Dani if you would like to.",
				ephemeral: true,
			});

		if (interaction.targetMessage.pinned) {
			(interaction.targetMessage as Message).unpin();
			return interaction.reply({
				content: "Unpinning message",
			});
		} else {
			(interaction.targetMessage as Message).pin();
			return interaction.reply({
				content: "Pinning message",
			});
		}
	});
}