import {
	ChatInputCommandInteraction,
	Client,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	Role,
	SlashCommandBuilder,
	SlashCommandRoleOption,
	SlashCommandStringOption,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

export const data = [
	new SlashCommandBuilder()
		.setName("pals")
		.setDescription("Manage your game roles")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("join")
				.setDescription("Assign a game role to yourself")
				.addRoleOption(new SlashCommandRoleOption().setName("role").setDescription("The role to assign").setRequired(true)),
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("leave")
				.setDescription("Remove a game role from yourself")
				.addRoleOption(new SlashCommandRoleOption().setName("role").setDescription("The role to remove").setRequired(true)),
		)
		.addSubcommand(new SlashCommandSubcommandBuilder().setName("list").setDescription("List all your game roles")),
	new SlashCommandBuilder()
		.setName("palscreate")
		.setDescription("Create a new game role")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.addStringOption(new SlashCommandStringOption().setName("name").setDescription("The role name").setRequired(true)),
];

type PalsRoleRecord = RecordModel & {
	//id: string // role id
	server_id: string;
};

export default function PalsRoles(client: Client, db: PocketBase) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "pals") handlePalsCommand(interaction);
		else if (interaction.isChatInputCommand() && interaction.commandName === "palscreate") handleCreateCommand(interaction);
	});

	async function handlePalsCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild || !interaction.guildId) return interaction.reply("This command can only be used in a server");
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild!.members.fetch(interaction.user.id);

		const subCommand = interaction.options.getSubcommand();
		const rolesRecords = await db.collection("mmd_pals_roles").getFullList<PalsRoleRecord>(200, { filter: `server_id = "${interaction.guildId}"` });
		const allRoles = rolesRecords.map((record) => record.id);
		if (subCommand === "join") {
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply("That role is not a valid pals role");
			}
			if (member.roles.cache.has(role.id)) {
				return await interaction.reply(`You are already in ${role.name}`);
			}
			await member.roles.add(role);
			return interaction.reply(`You have joined ${role.name}`);
		}
		if (subCommand === "leave") {
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply("That role is not a valid pals role");
			}
			if (!member.roles.cache.has(role.id)) {
				return await interaction.reply(`You are not in ${role.name}`);
			}
			await member.roles.remove(role);
			return interaction.reply(`You have left ${role.name}`);
		}
		if (subCommand === "list") {
			const roles = member.roles.cache.filter((role) => allRoles.includes(role.id)).map((role) => role.name);
			if (roles.length === 0) {
				return interaction.reply("You are not part of any group at the moment");
			}
			return interaction.reply("You are currently part of the following groups:\n- " + roles.join("\n- "));
		}
	}

	async function handleCreateCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild || !interaction.guildId) return interaction.reply("This command can only be used in a server");
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
			return interaction.reply({
				content: "You need the `Manage Roles` permission to create pals roles.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const name = interaction.options.getString("name", true);
		let role: Role;
		try {
			role = await interaction.guild.roles.create({ name });
		} catch (error) {
			console.error(error);
			return interaction.reply({
				content: "Error creating role.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const existing = await db
			.collection("mmd_pals_roles")
			.getFirstListItem<PalsRoleRecord>(`id = "${role.id}" && server_id = "${interaction.guildId}"`)
			.catch(() => null);
		if (!existing) await db.collection("mmd_pals_roles").create<PalsRoleRecord>({ id: role.id, server_id: interaction.guildId });

		return interaction.reply({
			content: `Created **${role.name}** and added it to pals roles.`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
