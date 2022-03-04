import { Client, GuildMember, Role } from "discord.js";
import { SlashCommandBuilder, SlashCommandRoleOption, SlashCommandSubcommandBuilder } from "@discordjs/builders";
import { Redis } from "ioredis";

export const data = [
	new SlashCommandBuilder()
		.setName("pronouns")
		.setDescription("Manage your pronoun roles")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("add")
				.setDescription("Assign a role to yourself (If your (neo)pronouns are not available, please DM or ping DaniDipp)")
				.addRoleOption(
					new SlashCommandRoleOption()
						.setName("role")
						.setDescription('The role to assign (type "/" to filter for pronouns)')
						.setRequired(true)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("remove")
				.setDescription("Remove a pronoun role from yourself")
				.addRoleOption(
					new SlashCommandRoleOption().setName("role").setDescription("The role to remove").setRequired(true)
				)
		)
		.addSubcommand(new SlashCommandSubcommandBuilder().setName("list").setDescription("List all your pronoun roles")),
];

export default function PronounRoles(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== "pronouns") return;

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "add") {
			const allRoles = await redis.smembers(`DiscordPronounRoles:${interaction.guildId}`);
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply({
					content: `${role.name} is not a pronoun role`,
					ephemeral: true,
				});
			}
			const member = interaction.member as GuildMember;
			if (member.roles.cache.has(role.id)) {
				return await interaction.reply({
					content: `${role.name} is already one of your pronouns`,
					ephemeral: true,
				});
			}
			await member.roles.add(role);
			return interaction.reply({
				content: `Added ${role.name} to your pronouns`,
				ephemeral: true,
			});
		}
		if (subCommand === "remove") {
			const allRoles = await redis.smembers(`DiscordPronounRoles:${interaction.guildId}`);
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply({
					content: `${role.name} is not a pronoun role`,
					ephemeral: true,
				});
			}
			const member = interaction.member as GuildMember;
			if (!member.roles.cache.has(role.id)) {
				return await interaction.reply({
					content: `${role.name} is not one of your pronouns`,
					ephemeral: true,
				});
			}
			await member.roles.remove(role);
			return interaction.reply({
				content: `Removed ${role.name} from your pronouns`,
				ephemeral: true,
			});
		}
		if (subCommand === "list") {
			const allRoles = await redis.smembers(`DiscordPronounRoles:${interaction.guildId}`);
			const member = interaction.member as GuildMember;
			const roles = member.roles.cache.filter((role) => allRoles.includes(role.id)).map((role) => role.name);
			if (roles.length === 0) {
				return interaction.reply({
					content: "You didn't set up any pronoun roles yet",
					ephemeral: true,
				});
			}
			return interaction.reply({
				content: `Your current pronouns are:\n• ${roles.join("\n• ")}`,
				ephemeral: true,
			});
		}
	});

	client.on("messageCreate", async (message): Promise<any> => {
		if (message.author.bot) return;
		if (!message.guild) return;
		if (message.guild.id !== "391355330241757205") return; // Only rawb.tv server

		const params = message.content.split(" ");
		if (params[0] !== "!pronouns") return;
		if (params[1] === "add") {
			if (!params[2]) return message.reply("Please specify a role name.");
			const [_command, _subcommand, ...rest] = params;
			const name = rest.join(" ");
			let role: Role;
			try {
				role = await message.guild.roles.create({
					name,
				});
			} catch (e) {
				console.error(e);
				return message.reply("Error creating role.");
			}

			try {
				await redis.sadd(`DiscordPronounRoles:${message.guild.id}`, role.id);
			} catch (e) {
				console.error(e);
				return message.reply("Error saving role to database.");
			}

			return message.reply("Added pronoun role " + role.name + ".");
		}
	});
}
