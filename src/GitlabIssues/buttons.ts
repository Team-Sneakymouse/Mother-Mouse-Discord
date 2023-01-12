import { Gitlab } from "@gitbeaker/node";
import { ButtonInteraction, Client, ComponentType, Interaction, ModalBuilder, TextInputStyle } from "discord.js";
import { projectIds, Projects } from "./utils.js";

export default function (client: Client, gitlab: InstanceType<typeof Gitlab>) {
	return {
		matcher: function (i: Interaction): i is ButtonInteraction {
			return i.isButton() && i.customId.startsWith("issue-");
		},
		handler: async function (interaction: ButtonInteraction) {
			const [action, iid] = interaction.customId.split("-")[1].split("_") as ["edit" | "open" | "close", string];
			const project_id = projectIds[interaction.guildId as Projects];

			if (action == "edit") {
				const title = interaction.message.embeds[0].title;
				const description = interaction.message.embeds[0].description;

				await interaction.showModal(
					new ModalBuilder({
						title: "New Bug/Feature Request",
						customId: `issue-edit_${project_id}-${iid}`,
						components: [
							{
								type: ComponentType.ActionRow,
								components: [
									{
										type: ComponentType.TextInput,
										style: TextInputStyle.Short,
										label: "Title",
										customId: "title",
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
										customId: "description",
										required: false,
										value: description || undefined,
									},
								],
							},
						],
					}).toJSON()
				);
			} else if (action == "open") {
				const issue = await gitlab.Issues.edit(project_id, parseInt(iid), {
					state_event: "reopen",
				});
				await interaction.reply({
					content: `Issue **#${issue.iid}** has been reopened.`,
					ephemeral: true,
				});
			} else if (action == "close") {
				const issue = await gitlab.Issues.edit(project_id, parseInt(iid), {
					state_event: "close",
				});
				await interaction.reply({
					content: `Issue **#${issue.iid}** has been closed.`,
					ephemeral: true,
				});
			}
		},
	};
}
