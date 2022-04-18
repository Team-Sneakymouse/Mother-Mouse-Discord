import {
	ChatInputCommandInteraction,
	Client,
	CommandInteraction,
	ComponentType,
	GuildMember,
	MessageOptions,
	MessagePayload,
	Role,
	SelectMenuInteraction,
	TextChannel,
} from "discord.js";
import { SlashCommandBuilder, SlashCommandRoleOption, SlashCommandSubcommandBuilder } from "@discordjs/builders";
import { Redis } from "ioredis";

export const data = [
	new SlashCommandBuilder()
		.setName("pals")
		.setDescription("Manage your game roles")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("join")
				.setDescription("Assign a game role to yourself")
				.addRoleOption(
					new SlashCommandRoleOption()
						.setName("role")
						.setDescription("The role to assign (type @pals to filter)")
						.setRequired(true)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("leave")
				.setDescription("Remove a game role from yourself")
				.addRoleOption(
					new SlashCommandRoleOption().setName("role").setDescription("The role to remove").setRequired(true)
				)
		)
		.addSubcommand(new SlashCommandSubcommandBuilder().setName("list").setDescription("List all your game roles")),
];

export default function PalsRoles(client: Client, redis: Redis) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName == "pals") handlePalsCommand(interaction);
		else if (interaction.isSelectMenu() && interaction.customId == "palsSelect") handleRolesUpdate(interaction);
	});

	client.on("messageCreate", async (message): Promise<any> => {
		if (message.author.bot) return;
		if (message.guild == null) return;

		const params = message.content.split(" ");
		if (params[0] !== "!pals") return;
		if (params[1] == "post") {
			const palsMessage = await redis.get(`DiscordPalsMessage:${message.guild.id}`);
			if (palsMessage) return message.reply("Message already exists in this server");

			const channelId = params[2]?.replace(/[<#>]/g, "");
			const channel = message.guild.channels.cache.get(channelId) || message.channel;
			if (!channel.isText()) return message.reply("Channel is not a text channel");

			const roleIds = await redis.smembers(`DiscordPalsRoles:${message.guild.id}`);
			const roles = roleIds.map((id) => message.guild!.roles.cache.get(id)).filter((r) => r !== undefined) as Role[];
			const newMessage = await channel.send(getPalsMessage(roles));
			newMessage.suppressEmbeds();
			await redis.set(`DiscordPalsMessage:${message.guild.id}`, `${newMessage.channelId}-${newMessage.id}`);
			return message.react("✅");
		} else if (params[1] === "update") {
			const redisResult = await redis.get(`DiscordPalsMessage:${message.guild.id}`);
			editMessage: if (redisResult) {
				console.log("Found message");
				const [PalsMessageChannelId, PalsMessageId] = redisResult.split("-");
				const palsChannel = message.guild.channels.cache.get(PalsMessageChannelId) as TextChannel;
				if (!palsChannel) break editMessage;
				const palsMessage = await palsChannel.messages.fetch(PalsMessageId);
				if (!palsMessage) break editMessage;

				const roleIds = await redis.smembers(`DiscordPalsRoles:${message.guild.id}`);
				const roles = roleIds.map((id) => message.guild!.roles.cache.get(id)).filter((r) => r !== undefined) as Role[];
				await palsMessage.edit(getPalsMessage(roles));
			}
		} else if (params[1] === "add") {
			if (!params[2]) return message.reply("Please specify a role name.");
			const [_command, _subcommand, ...rest] = params;
			const name = rest.join(" ");
			let role;
			try {
				role = await message.guild.roles.create({
					name,
				});
			} catch (e) {
				console.error(e);
				return message.reply("Error creating role.");
			}

			try {
				await redis.sadd(`DiscordPalsRoles:${message.guild.id}`, role.id);
			} catch (e) {
				console.error(e);
				return message.reply("Error saving role to database.");
			}

			const redisResult = await redis.get(`DiscordPalsMessage:${message.guild.id}`);
			editMessage: if (redisResult) {
				console.log("Found message");
				const [PalsMessageChannelId, PalsMessageId] = redisResult.split("-");
				const palsChannel = message.guild.channels.cache.get(PalsMessageChannelId) as TextChannel;
				if (!palsChannel) break editMessage;
				const palsMessage = await palsChannel.messages.fetch(PalsMessageId);
				if (!palsMessage) break editMessage;

				const roleIds = await redis.smembers(`DiscordPalsRoles:${message.guild.id}`);
				const roles = roleIds.map((id) => message.guild!.roles.cache.get(id)).filter((r) => r !== undefined) as Role[];
				await palsMessage.edit(getPalsMessage(roles));
			}

			return message.react("✅");
		}
	});

	async function handlePalsCommand(interaction: ChatInputCommandInteraction) {
		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "join") {
			const allRoles = await redis.smembers(`DiscordPalsRoles:${interaction.guildId}`);
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply("That role is not a valid pals role");
			}
			const member = interaction.member as GuildMember;
			if (member.roles.cache.has(role.id)) {
				return await interaction.reply(`You are already in ${role.name}`);
			}
			await member.roles.add(role);
			return interaction.reply(`You have joined ${role.name}`);
		}
		if (subCommand === "leave") {
			const allRoles = await redis.smembers(`DiscordPalsRoles:${interaction.guildId}`);
			const role = interaction.options.getRole("role") as Role;
			if (!allRoles.includes(role.id)) {
				return interaction.reply("That role is not a valid pals role");
			}
			const member = interaction.member as GuildMember;
			if (!member.roles.cache.has(role.id)) {
				return await interaction.reply(`You are not in ${role.name}`);
			}
			await member.roles.remove(role);
			return interaction.reply(`You have left ${role.name}`);
		}
		if (subCommand === "list") {
			const allRoles = await redis.smembers(`DiscordPalsRoles:${interaction.guildId}`);
			const member = interaction.member as GuildMember;
			const roles = member.roles.cache.filter((role) => allRoles.includes(role.id)).map((role) => role.name);
			if (roles.length === 0) {
				return interaction.reply("You are not part of any group at the moment");
			}
			return interaction.reply("You are currently currently part of the following groups:\n• " + roles.join("\n• "));
		}
	}

	async function handleRolesUpdate(interaction: SelectMenuInteraction) {
		console.log("Roles update");
		const member = interaction.member as GuildMember;
		const allRoles = await redis.smembers(`DiscordPalsRoles:${interaction.guildId}`);
		console.log("allRoles:", allRoles);

		const currentRoles = Array.from(member.roles.cache.keys()).filter((id) => allRoles.includes(id));
		const missingRoles = allRoles.filter((roleId) => !currentRoles.includes(roleId) && interaction.values.includes(roleId));
		const tooManyRoles = currentRoles.filter((roleId) => !interaction.values.includes(roleId));

		const removeRolesPromises = tooManyRoles.map((roleId) => member.roles.remove(roleId));
		const addRolesPromises = missingRoles.map((roleId) => member.roles.add(roleId));

		const nowRoles = [
			...currentRoles.filter((roleId) => allRoles.includes(roleId) && !tooManyRoles.includes(roleId)),
			...missingRoles,
		].map((roleId) => member.guild.roles.cache.get(roleId)?.name);

		await Promise.all([...removeRolesPromises, ...addRolesPromises]);

		if (nowRoles.length == 0) {
			return await interaction.reply({
				content: `You have oped out of all pals roles`,
				ephemeral: true,
			});
		}
		return interaction.reply({
			content: "You are currently currently part of the following groups:\n• " + nowRoles.join("\n• "),
			ephemeral: true,
		});
	}
}

function getPalsMessage(roles: Role[]) {
	return {
		content: "\u00A0",
		embeds: [
			{
				title: "Pals",
			},
		],
		components: [
			{
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.SelectMenu,
						customId: "palsSelect",
						options: roles.map((role) => ({
							label: role.name,
							value: role.id,
							emoji: undefined, //role.client.emojis.cache.get(role.id)
						})),
						maxValues: roles.length,
						minValues: 0,
					},
				],
			},
		],
	};
}
