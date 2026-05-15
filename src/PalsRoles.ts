import {
	type ChatInputCommandInteraction,
	type Client,
	GuildMember,
	MessageFlags,
	PermissionFlagsBits,
	type Role,
	SlashCommandBuilder,
	SlashCommandRoleOption,
	SlashCommandStringOption,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

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
		.setName("palsadmin")
		.setDescription("Manage pals roles")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("create")
				.setDescription("Create a new pals role")
				.addStringOption(new SlashCommandStringOption().setName("name").setDescription("The role name").setRequired(true)),
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("add")
				.setDescription("Make an existing role a pals role")
				.addRoleOption(new SlashCommandRoleOption().setName("role").setDescription("The role to make a pals role").setRequired(true)),
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("remove")
				.setDescription("Make a pals role a non-pals role")
				.addRoleOption(new SlashCommandRoleOption().setName("role").setDescription("The pals role to remove").setRequired(true)),
		),
];

type PalsRoleRecord = RecordModel & {
	//id: string // role id
	server_id: string;
};

export default function PalsRoles(client: Client, db: PocketBase) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "pals") handlePalsCommand(interaction);
		else if (interaction.isChatInputCommand() && interaction.commandName === "palsadmin") handlePalsAdminCommand(interaction);
	});

	async function handlePalsCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild || !interaction.guildId) return interaction.reply("This command can only be used in a server");
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);

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
			return interaction.reply(`You are currently part of the following groups:\n- ${roles.join("\n- ")}`);
		}
	}

	async function handlePalsAdminCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild || !interaction.guildId) return interaction.reply("This command can only be used in a server");

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "create") return handleCreateCommand(interaction);
		if (subCommand === "add") return handleAddCommand(interaction);
		if (subCommand === "remove") return handleRemoveCommand(interaction);
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

		await addPalsRole(interaction.guildId, role.id);

		return interaction.reply({
			content: `Created **${role.name}** and added it to pals roles.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	async function handleAddCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply("This command can only be used in a server");
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
			return interaction.reply({
				content: "You need the `Manage Roles` permission to add pals roles.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const role = interaction.options.getRole("role", true) as Role;
		const added = await addPalsRole(interaction.guildId, role.id);

		return interaction.reply({
			content: added ? `Added **${role.name}** to pals roles.` : `**${role.name}** is already a pals role.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	async function handleRemoveCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guildId) return interaction.reply("This command can only be used in a server");
		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
			return interaction.reply({
				content: "You need the `Manage Roles` permission to remove pals roles.",
				flags: MessageFlags.Ephemeral,
			});
		}

		const role = interaction.options.getRole("role", true) as Role;
		const existing = await getPalsRole(interaction.guildId, role.id);
		if (!existing) {
			return interaction.reply({
				content: `**${role.name}** is not a pals role.`,
				flags: MessageFlags.Ephemeral,
			});
		}

		await db.collection("mmd_pals_roles").delete(role.id);
		return interaction.reply({
			content: `Removed **${role.name}** from pals roles. The Discord role was not deleted.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	async function addPalsRole(serverId: string, roleId: string) {
		const existing = await getPalsRole(serverId, roleId);
		if (existing) return false;

		await db.collection("mmd_pals_roles").create<PalsRoleRecord>({ id: roleId, server_id: serverId });
		return true;
	}

	async function getPalsRole(serverId: string, roleId: string) {
		return db
			.collection("mmd_pals_roles")
			.getFirstListItem<PalsRoleRecord>(`id = "${roleId}" && server_id = "${serverId}"`)
			.catch(() => null);
	}
}
