import {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	Client,
	ComponentType,
	GuildMember,
	ModalBuilder,
	ModalSubmitInteraction,
	SlashCommandBuilder,
	SlashCommandStringOption,
	SlashCommandSubcommandBuilder,
	TextInputStyle,
} from "discord.js";
import { Redis } from "ioredis";

export const data = [
	new SlashCommandBuilder()
		.setName("pronouns")
		.setDescription("Manage your pronoun roles")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("add")
				.setDescription("Assign a pronoun role to yourself")
				.addStringOption(
					new SlashCommandStringOption()
						.setName("pronoun")
						.setRequired(true)
						.setDescription("The pronoun role to assign")
						.setAutocomplete(true)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("remove")
				.setDescription("Remove a pronoun role from yourself")
				.addStringOption(
					new SlashCommandStringOption()
						.setName("pronoun")
						.setRequired(true)
						.setDescription("The pronoun role to remove")
						.setAutocomplete(true)
				)
		),
];

export default function PronounRoles(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isAutocomplete() && interaction.commandName === "pronouns") return await handleAutocomplete(interaction);
		if (interaction.isChatInputCommand() && interaction.commandName === "pronouns") return await handleCommand(interaction);
		if (interaction.isModalSubmit() && interaction.customId === "pronoun_role_create") return await handleModal(interaction);
	});

	async function handleAutocomplete(interaction: AutocompleteInteraction) {
		if (!interaction.guild)
			return interaction.respond([
				{
					name: "Error: Can't retrieve guild info. Please tell Dani",
					value: "error",
				},
			]);
		if (!(interaction.member instanceof GuildMember))
			return interaction.respond([
				{
					name: "Error: Can't retrieve member info. Please tell Dani",
					value: "error",
				},
			]);
		const member = interaction.member;

		const subcommand = interaction.options.getSubcommand();
		const autocomplete = interaction.options.getFocused() as string;

		const allRoleIds = await redis.smembers(`DiscordPronounRoles:${interaction.guildId}`);
		if (subcommand === "add") {
			const roles = interaction.guild.roles.cache.filter(
				(role) => allRoleIds.includes(role.id) && !member.roles.cache.has(role.id)
			);
			const filteredRoles = roles.filter((role) => role.name.toLowerCase().includes(autocomplete.toLowerCase()));
			const responses = filteredRoles.map((role) => ({ name: role.name, value: role.id }));
			responses.push({ name: "Add new...", value: "create_role" });
			return interaction.respond(responses);
		} else if (subcommand === "remove") {
			const roles = member.roles.cache.filter((r) => allRoleIds.includes(r.id));
			interaction.respond(roles.map((r) => ({ name: r.name, value: r.id })));
		} else {
			console.error(
				`Command ${interaction.commandName}: Received autocomplete interaction for unknown subcommand ${subcommand}`
			);
			interaction.respond([{ name: "Unknown Subcommand. Please tell Dani!", value: "error" }]);
		}
	}

	async function handleCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) {
			interaction.reply({
				content: "Couldn't create pronoun role because the guild is invalid.",
				ephemeral: true,
			});
			return;
		}
		if (!(interaction.member instanceof GuildMember)) {
			interaction.reply({
				content: "Couldn't assign pronoun role because I can't access the member object.",
				ephemeral: true,
			});
			return;
		}

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "add") {
			const optionValue = interaction.options.getString("pronoun");
			if (!optionValue) {
				interaction.reply({
					content: "Please specify a pronoun role.",
					ephemeral: true,
				});
				return;
			}
			if (optionValue === "create_role") {
				interaction.showModal(createPronounModal);
				return;
			}

			const role = interaction.guild.roles.cache.get(optionValue);
			if (!role) {
				interaction.reply({
					content: `Couldn't find a pronoun role with the id \`${optionValue}\`. Please tell Dani.`,
					ephemeral: true,
				});
				return;
			}
			await interaction.member.roles.add(role);
			interaction.reply({
				content: `Assigned the pronoun role **${role.name}** to you.`,
				ephemeral: true,
			});
		} else if (subCommand === "remove") {
			const allRoles = await redis.smembers(`DiscordPronounRoles:${interaction.guildId}`);
			const optionValue = interaction.options.getString("pronoun");
			if (!optionValue) {
				interaction.reply({
					content: "Please specify a pronoun role.",
					ephemeral: true,
				});
				return;
			}
			const role = interaction.guild.roles.cache.get(optionValue);
			if (!role) {
				interaction.reply({
					content: `Couldn't find a pronoun role with the id \`${optionValue}\`. Please tell Dani.`,
					ephemeral: true,
				});
				return;
			}
			await interaction.member.roles.remove(role);
			interaction.reply({
				content: `Removed **${role.name}** from your pronouns`,
				ephemeral: true,
			});
			return;
		}
	}

	async function handleModal(interaction: ModalSubmitInteraction) {
		if (!interaction.guild) {
			interaction.reply({
				content: "Couldn't create pronoun role because the guild is invalid.",
				ephemeral: true,
			});
			return;
		}
		if (!(interaction.member instanceof GuildMember)) {
			interaction.reply({
				content: "Couldn't assign pronoun role because I can't access the member object.",
				ephemeral: true,
			});
			return;
		}

		const subjectPronoun = interaction.fields.getTextInputValue("pronoun_role_create_subject").toLowerCase();
		const objectPronoun = interaction.fields.getTextInputValue("pronoun_role_create_object").toLowerCase();
		const possessivePronoun = interaction.fields.getTextInputValue("pronoun_role_create_possessive").toLowerCase();
		if ((subjectPronoun + objectPronoun + possessivePronoun).includes("/")) {
			interaction.reply({
				content: "Couldn't parse pronouns because there are slashes in them. If this is intentional, please tell Dani.",
				ephemeral: true,
			});
			return;
		}
		const roleName = `${subjectPronoun}/${objectPronoun}/${possessivePronoun}`;
		const role = interaction.guild.roles.cache.find((r) => r.name === roleName);
		if (role) {
			await interaction.member.roles.add(role);
			interaction.reply({
				content: `There already is a role with the pronouns **${roleName}**, so I assigned that one to you.`,
				ephemeral: true,
			});
			return;
		}
		const newRole = await interaction.guild.roles.create({
			name: roleName,
			permissions: BigInt(0),
			reason: `Pronoun role created by ${interaction.member.displayName}`,
		});
		await redis.sadd(`DiscordPronounRoles:${interaction.guildId}`, newRole.id);
		await interaction.member.roles.add(newRole);
		interaction.reply({
			content: `The pronoun role **${newRole.name}** has been created and I assigned it to you.`,
			ephemeral: true,
		});
	}
}

const createPronounModal = new ModalBuilder({
	title: "Create Pronoun Role",
	customId: "pronoun_role_create",
	components: [
		{
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.TextInput,
					style: TextInputStyle.Short,
					label: "Subject Pronoun (e.g. he, she, they)",
					customId: "pronoun_role_create_subject",
					required: true,
				},
			],
		},
		{
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.TextInput,
					style: TextInputStyle.Short,
					label: "Object Pronoun (e.g. him, her, them)",
					customId: "pronoun_role_create_object",
					required: true,
				},
			],
		},
		{
			type: ComponentType.ActionRow,
			components: [
				{
					type: ComponentType.TextInput,
					style: TextInputStyle.Short,
					label: "Possessive Pronoun (e.g. his, hers, theirs)",
					customId: "pronoun_role_create_possessive",
					required: true,
				},
			],
		},
	],
});
