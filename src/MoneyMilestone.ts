import { Client, Message, ContextMenuCommandBuilder } from "discord.js";

export const data = [new ContextMenuCommandBuilder().setType(3).setName("Mark as done")];

export default function MoneyMilestone(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isContextMenuCommand() && interaction.commandName === "Mark as done") {
			const msg = interaction.options.getMessage("message") as Message;
			if (msg.webhookId == null) {
				interaction.reply({
					content: "Can't mark this message as done",
					ephemeral: true,
				});
				return;
			}

			const content = msg.content;
			const webhook = await msg.fetchWebhook();
			await webhook.editMessage(msg.id, {
				content: `~~${content}~~`,
			});
			interaction.reply({
				content: "marked as done!",
				ephemeral: true,
			});
		}
	});
}
