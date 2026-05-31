import { Gitlab } from "@gitbeaker/node";
import { Client, Interaction, ModalSubmitInteraction, MessageFlags } from "discord.js";

export default function (client: Client, gitlab: InstanceType<typeof Gitlab>) {
	return {
		matcher: function (i: Interaction): i is ModalSubmitInteraction {
			return i.isModalSubmit() && (i.customId.startsWith("issue-create_") || i.customId.startsWith("issue-edit_"));
		},
		handler: async function (interaction: ModalSubmitInteraction) {
			const title = interaction.fields.getTextInputValue("title");
			const description = `![Profile Image](${interaction.user.avatarURL({ size: 16 })}) **${
				interaction.user.username
			}** via [#bugs](https://discord.com/channels/768372809616850964/768375421854810162/)\n\n---\n${interaction.fields
				.getTextInputValue("description")
				.replaceAll(/([^\n\s])\n([^\n\s])/g, "$1  \n$2")}`;
			const [projectId, iid] = interaction.customId.split("_")[1].split("-");

			if (interaction.customId.startsWith("issue-create_")) {
				const issue = await gitlab.Issues.create(projectId, {
					title,
					description,
				});
				await interaction.reply({
					content: `Issue **#${issue.iid}** has been created.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			} else if (interaction.customId.startsWith("issue-edit_")) {
				await gitlab.Issues.edit(projectId, parseInt(iid), {
					title,
					description,
				});
				await interaction.reply({
					content: `Issue **#${iid}** has been updated.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			} else {
				throw new Error(`Unknown customId: ${interaction.customId}`);
			}
		},
	};
}
