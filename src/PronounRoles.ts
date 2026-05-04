import {
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	type Client,
	ComponentType,
	GuildMember,
	ModalBuilder,
	type ModalSubmitInteraction,
	SlashCommandBuilder,
	SlashCommandStringOption,
	SlashCommandSubcommandBuilder,
	TextInputStyle,
} from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

export const data = [
	new SlashCommandBuilder()
		.setName("pronouns")
		.setDescription("Manage your pronoun roles")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("add")
				.setDescription("Assign a pronoun role to yourself")
				.addStringOption(
					new SlashCommandStringOption().setName("pronoun").setRequired(true).setDescription("The pronoun role to assign").setAutocomplete(true),
				),
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("remove")
				.setDescription("Remove a pronoun role from yourself")
				.addStringOption(
					new SlashCommandStringOption().setName("pronoun").setRequired(true).setDescription("The pronoun role to remove").setAutocomplete(true),
				),
		),
];

type PronounRoleRecord = RecordModel & {
	// id: string // role id
	server_id: string;
};

export default function PronounRoles(client: Client, db: PocketBase) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isAutocomplete() && interaction.commandName === "pronouns") return await handleAutocomplete(interaction);
		if (interaction.isChatInputCommand() && interaction.commandName === "pronouns") return await handleCommand(interaction);
		if (interaction.isModalSubmit() && interaction.customId === "pronoun_role_create") return await handleModal(interaction);
	});

	async function handleAutocomplete(interaction: AutocompleteInteraction) {
		if (!interaction.guild || !interaction.guildId)
			return interaction.respond([
				{
					name: "Error: Can't retrieve guild info. Please tell Dani",
					value: "error",
				},
			]);
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);

		const subcommand = interaction.options.getSubcommand();
		const autocomplete = interaction.options.getFocused() as string;

		const allRoleIds = await getPronounRoleIds(interaction.guildId);
		if (subcommand === "add") {
			const roles = interaction.guild.roles.cache.filter((role) => allRoleIds.includes(role.id) && !member.roles.cache.has(role.id));
			const filteredRoles = roles.filter((role) => role.name.toLowerCase().includes(autocomplete.toLowerCase()));
			const responses = filteredRoles.map((role) => ({ name: role.name, value: role.id }));
			responses.push({ name: "Add new...", value: "create_role" });
			return interaction.respond(responses);
		} else if (subcommand === "remove") {
			const roles = member.roles.cache.filter((r) => allRoleIds.includes(r.id));
			interaction.respond(roles.map((r) => ({ name: r.name, value: r.id })));
		} else {
			console.error(`Command ${interaction.commandName}: Received autocomplete interaction for unknown subcommand ${subcommand}`);
			interaction.respond([{ name: "Unknown Subcommand. Please tell Dani!", value: "error" }]);
		}
	}

	async function handleCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild || !interaction.guildId) {
			interaction.reply({
				content: "Couldn't create pronoun role because the guild is invalid.",
				ephemeral: true,
			});
			return;
		}
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);

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

			const role = interaction.guild.roles.cache.get(optionValue);
			if (optionValue === "create_role") {
			}

			if (!role) {
				interaction.showModal(createPronounModal(optionValue.replace("create_role", "")));
				return;
			}
			await member.roles.add(role);
			interaction.reply({
				content: `Assigned the pronoun role **${role.name}** to you.`,
				ephemeral: true,
			});
		} else if (subCommand === "remove") {
			const allRoles = await getPronounRoleIds(interaction.guildId);
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
			if (!allRoles.includes(role.id)) {
				interaction.reply({
					content: `The role \`${role.name}\` is not a pronoun role. Please get a Helpful Turtle to remove it.`,
					ephemeral: true,
				});
				return;
			}
			await member.roles.remove(role);
			interaction.reply({
				content: `Removed **${role.name}** from your pronouns`,
				ephemeral: true,
			});
			return;
		}
	}

	async function handleModal(interaction: ModalSubmitInteraction) {
		if (!interaction.guild || !interaction.guildId) {
			interaction.reply({
				content: "Couldn't create pronoun role because the guild is invalid.",
				ephemeral: true,
			});
			return;
		}
		const member = interaction.member instanceof GuildMember ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);

		const subjectPronoun = interaction.fields.getTextInputValue("pronoun_role_create_subject").toLowerCase();
		const objectPronoun = interaction.fields.getTextInputValue("pronoun_role_create_object")?.toLowerCase();
		const possessivePronoun = interaction.fields.getTextInputValue("pronoun_role_create_possessive")?.toLowerCase();
		if ((subjectPronoun + objectPronoun + possessivePronoun).includes("/")) {
			interaction.reply({
				content: "Couldn't parse pronouns because there are slashes in them. If this doesn't make sense to you, please tell Dani to make it more clear.",
				ephemeral: true,
			});
			return;
		}
		let roleName = subjectPronoun;
		roleName += !!objectPronoun ? `/${objectPronoun}` : `/-`;
		roleName += !!possessivePronoun ? `/${possessivePronoun}` : `/-`;

		const role = interaction.guild.roles.cache.find((r) => r.name === roleName);
		if (role) {
			await addPronounRole(interaction.guildId, role.id);
			await member.roles.add(role);
			interaction.reply({
				content: `There already is a role with the pronouns **${roleName}**, so I assigned that one to you.`,
				ephemeral: true,
			});
			return;
		}
		const newRole = await interaction.guild.roles.create({
			name: roleName,
			permissions: BigInt(0),
			reason: `Pronoun role created by ${member.displayName}`,
		});
		await addPronounRole(interaction.guildId, newRole.id);
		await member.roles.add(newRole);
		interaction.reply({
			content: `The pronoun role **${newRole.name}** has been created and I assigned it to you.`,
			ephemeral: true,
		});
	}

	async function getPronounRoleIds(serverId: string) {
		const records = await db.collection("mmd_pronoun_roles").getFullList<PronounRoleRecord>(200, {
			filter: `server_id = "${serverId}"`,
		});
		return records.map((record) => record.id);
	}

	async function addPronounRole(serverId: string, roleId: string) {
		try {
			return await db.collection("mmd_pronoun_roles").update<PronounRoleRecord>(roleId, {
				server_id: serverId,
			});
		} catch (error) {
			if ((error as any).status === 404) {
				return db.collection("mmd_pronoun_roles").create<PronounRoleRecord>({
					id: roleId,
					server_id: serverId,
				});
			}
			throw error;
		}
	}
}

const createPronounModal = (prompt: string) => {
	const pronouns = prompt.trim().split("/");
	return new ModalBuilder({
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
						value: pronouns[0] || "",
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
						required: false,
						value: pronouns[1] || "",
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
						required: false,
						value: pronouns[2] || "",
					},
				],
			},
		],
	});
};
