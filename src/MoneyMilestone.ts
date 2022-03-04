import { Client, Message } from "discord.js";
import { ContextMenuCommandBuilder } from "@discordjs/builders";
import { ApplicationCommandType } from "discord-api-types/v9";

export const data = [new ContextMenuCommandBuilder().setType(ApplicationCommandType.Message).setName("Mark as done")];

export default function MoneyMilestone(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isContextMenuCommand() && interaction.commandName === "Mark as done") {
			const msg = interaction.options.getMessage("message") as Message;
			if (msg.webhookId == null)
				return interaction.reply({
					content: "Can't mark this message as done",
					ephemeral: true,
				});

			const content = msg.content;
			const webhook = await msg.fetchWebhook();
			await webhook.editMessage(msg.id, {
				content: `~~${content}~~`,
			});
			return interaction.reply({
				content: "marked as done!",
				ephemeral: true,
			});
		}
	});
}
