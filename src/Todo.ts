import {
	ButtonInteraction,
	Client,
	CommandInteraction,
	Message,
	MessageEmbedAuthor,
	MessageOptions,
	MessagePayload,
	TextChannel,
} from "discord.js";
import { SlashCommandBuilder, SlashCommandStringOption } from "@discordjs/builders";
export const data = new SlashCommandBuilder()
	.setName("todo")
	.setDescription("Add a todo")
	.addStringOption(new SlashCommandStringOption().setName("item").setDescription("Item to add").setRequired(true));

export default function Roll(client: Client) {
	client.on("messageCreate", (message) => {
		if (!message.guild) return;
		if (message.channelId !== "877383821631320157") return;
		if (!message.author.bot) return;
		message.delete();
	});

	client.on("interactionCreate", (interaction) => {
		if (interaction.isCommand() && interaction.commandName == "todo") return handleTodoCommand(interaction);
		if (interaction.isButton() && interaction.customId == "done") return handleDoneButton(interaction);
	});

	async function handleTodoCommand(interaction: CommandInteraction) {
		const item = interaction.options.getString("item");
		if (!item)
			return interaction.reply({
				content: "You must provide an item to add",
				ephemeral: true,
			});

		let message: Message;
		if (interaction.channel?.id === "877383821631320157") {
			await interaction.reply(
				generateTodoMessage(item, {
					name: interaction.user.username,
					iconURL: interaction.user.avatarURL() || undefined,
				})
			);
			message = (await interaction.fetchReply()) as Message;
		} else {
			var channel = client.channels.cache.get("877383821631320157") as TextChannel;
			if (!channel) channel = (await client.channels.fetch("877383821631320157")) as TextChannel;

			message = await channel.send(
				generateTodoMessage(item, {
					name: interaction.user.username,
					iconURL: interaction.user.avatarURL() || undefined,
				})
			);
			return interaction.reply({
				content: "Added todo",
				ephemeral: true,
			});
		}
		message.startThread({
			name: item.length >= 100 ? item.substring(0, 99) + "\u2026" : item,
			autoArchiveDuration: 1440,
		});
	}

	async function handleDoneButton(interaction: ButtonInteraction) {
		const item = interaction.message.embeds[0].description;
		if (!item)
			return interaction.reply({
				content: "Item not found (embed description)",
				ephemeral: true,
			});

		const message = interaction.message as Message;
		await Promise.all([
			message.edit(generateTodoMessage(item, interaction.message.embeds[0].author || undefined, true)),
			message.thread?.setArchived(true),
		]);

		interaction.reply({
			content: "Marked as done",
			ephemeral: true,
		});
	}
}

function generateTodoMessage(
	item: string,
	author: MessageEmbedAuthor | undefined,
	done = false
): MessageOptions | MessagePayload {
	const payload: MessageOptions | MessagePayload = {
		embeds: [
			{
				author: author,
				description: done ? `~~${item}~~` : item,
				color: done ? "#202225" : "#A3A0E3",
				timestamp: new Date(),
			},
		],
		components: [],
	};
	if (!done) {
		payload.components!.push({
			type: "ACTION_ROW",
			components: [
				{
					type: "BUTTON",
					label: "Done",
					customId: "done",
					style: "PRIMARY",
				},
			],
		});
	}
	return payload;
}
