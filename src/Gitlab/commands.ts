import { SlashCommandBuilder, SlashCommandStringOption } from "@discordjs/builders";
import { ChatInputCommandInteraction, Client, ComponentType, Interaction, ModalBuilder, TextInputStyle } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import { createHash } from "crypto";
import { projectIds, Projects } from "./utils";

export const data = [
	new SlashCommandBuilder()
		.setName("report")
		.setDescription("Report a bug or feature request")
		.addStringOption(
			new SlashCommandStringOption()
				.setName("title")
				.setDescription("Short description of your bug/request")
				.setRequired(false)
		),
];

export default function (client: Client, gitlab: InstanceType<typeof Gitlab>) {
	return {
		matcher: function (i: Interaction): i is ChatInputCommandInteraction {
			return i.isChatInputCommand() && i.commandName === "report";
		},
		handler: async function (interaction: ChatInputCommandInteraction) {
			const title = interaction.options.getString("title") || undefined;

			const projectId = projectIds[interaction.guildId as Projects];
			if (!projectId)
				return interaction.reply({
					content:
						"This server is not configured for Gitlab integration. Please contact Dani if you can see this message!",
					ephemeral: true,
				});

			const id = title ? createHash("sha1").update(title).digest("hex").substring(0, 13) : Date.now().toString();

			return interaction.showModal(
				new ModalBuilder({
					title: "New Bug/Feature Request",
					custom_id: `issue-create_${projectId}_${id}`,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.TextInput,
									style: TextInputStyle.Short,
									label: "Title",
									custom_id: "title",
									required: true,
									value: title || undefined,
								},
							],
						},
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.TextInput,
									style: TextInputStyle.Paragraph,
									label: "Description",
									custom_id: "description",
									required: false,
								},
							],
						},
					],
				}).toJSON()
			);
		},
	};
}
