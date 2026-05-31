import { ApplicationCommandType, Client, ContextMenuCommandBuilder, PermissionFlagsBits } from "discord.js";

const RAWBTV_GUILD_ID = "391355330241757205";
const BUILD_TEAM_ROLE_ID = "1508599054735642654";

export const data = [
	new ContextMenuCommandBuilder()
		.setType(ApplicationCommandType.User)
		.setName("Add to Build Team")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	new ContextMenuCommandBuilder()
		.setType(ApplicationCommandType.User)
		.setName("Remove from Build Team")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
];

export default function BuildTeamManagement(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isUserContextMenuCommand()) return;
		if (interaction.commandName !== "Add to Build Team" && interaction.commandName !== "Remove from Build Team") return;

		if (interaction.guildId !== RAWBTV_GUILD_ID || !interaction.guild) {
			await interaction.reply({
				content: "This command can only be used in the configured server.",
				ephemeral: true,
			});
			return;
		}

		const member = await interaction.guild.members.fetch(interaction.targetUser.id).catch(() => null);
		if (!member) {
			await interaction.reply({
				content: "Could not find that member in this server.",
				ephemeral: true,
			});
			return;
		}

		const adding = interaction.commandName === "Add to Build Team";
		try {
			if (adding) {
				await member.roles.add(BUILD_TEAM_ROLE_ID, `Build team role added by ${interaction.user.tag}`);
			} else {
				await member.roles.remove(BUILD_TEAM_ROLE_ID, `Build team role removed by ${interaction.user.tag}`);
			}
		} catch (e) {
			const error = e instanceof Error ? e : new Error((e as any).toString());
			await interaction.reply({
				content: "Failed to update build team role:\n" + error.message,
				ephemeral: true,
			});
			return;
		}

		await interaction.reply({
			content: `${member.displayName} has been ${adding ? "added to" : "removed from"} the build team.`,
			ephemeral: true,
		});
	});
}
