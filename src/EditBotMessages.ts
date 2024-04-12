import {
	ActionRowBuilder,
	ApplicationCommandType,
	Client,
	ContextMenuCommandBuilder,
	ModalBuilder,
	PermissionFlagsBits,
	TextBasedChannel,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";

export const data = [
	new ContextMenuCommandBuilder()
		.setType(ApplicationCommandType.Message)
		.setName("Edit Message")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
];

export default function EditBotMessages(client: Client) {
	// 1. check if user may edit message
	// 2. show a modal with the message content
	// 3. wait for the modal to be submitted
	// 4. edit the message with the new content
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isMessageContextMenuCommand()) return;
		if (interaction.commandName !== "Edit Message") return;
		if (interaction.targetMessage.author.id !== client.user?.id) {
			await interaction.reply({
				content: "You can't edit this message.",
				ephemeral: true,
			});
			return;
		}
		if (!interaction.member || typeof interaction.member.permissions == "string") return;
		if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
			await interaction.reply({
				content: "You don't have permission to edit this message.",
				ephemeral: true,
			});
			return;
		}

		const content = interaction.targetMessage.content;
		const ids = [interaction.targetMessage.channelId, interaction.targetMessage.id].join("/");
		await interaction.showModal(makeModal(ids, content).toJSON());
	});

	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith("edit-message_")) return;
		const [channelId, messageId] = interaction.customId.split("_")[1].split("/");

		const content = interaction.fields.getTextInputValue("content");
		const message = await (interaction.guild?.channels.cache.get(channelId) as TextBasedChannel)?.messages.fetch(messageId);
		if (!message) {
			await interaction.reply({
				content: "Message not found.",
				ephemeral: true,
			});
			return;
		}
		try {
			await message.edit(content);
		} catch (e) {
			const error = e instanceof Error ? e : new Error((e as any).toString());
			await interaction.reply({
				content: "Failed to edit message:\n" + error.message,
				ephemeral: true,
			});
			return;
		}
		await interaction.reply({
			content: "Message edited.",
			ephemeral: true,
		});
	});
}

function makeModal(id: string, content: string): ModalBuilder {
	return new ModalBuilder()
		.setTitle("Edit Message")
		.setCustomId("edit-message_" + id)
		.addComponents([
			new ActionRowBuilder({
				components: [
					new TextInputBuilder()
						.setCustomId("content")
						.setLabel("Content")
						.setValue(content)
						.setRequired(true)
						.setStyle(TextInputStyle.Paragraph),
				],
			}),
		]);
}
