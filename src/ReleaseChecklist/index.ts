import { randomUUID } from "node:crypto";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	InteractionContextType,
	LabelBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle,
	escapeMarkdown,
	type APIContainerComponent,
	type ButtonInteraction,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
} from "discord.js";
import { PREFIX, readRelease, releaseName, renderRelease, type Release } from "./card.js";

export const data = [
	new SlashCommandBuilder()
		.setName("release")
		.setDescription("Create a release checklist")
		.setContexts(InteractionContextType.Guild)
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption((option) => option.setName("title").setDescription("Title of the next release").setRequired(true).setMaxLength(120)),
];

type ChecklistInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

function canUpdateSource(interaction: ChecklistInteraction) {
	return !interaction.isModalSubmit() || interaction.isFromMessage();
}

function nameModal(action: string, messageId: string, value = "", featureId = "") {
	const input = new TextInputBuilder().setCustomId("name").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120);
	if (value) input.setValue(value);
	return new ModalBuilder()
		.setCustomId(`${PREFIX}${action}:${messageId}:${featureId}`)
		.setTitle(action === "add-submit" ? "Add feature" : action === "rename-submit" ? "Rename release" : "Edit feature")
		.addLabelComponents(new LabelBuilder().setLabel(action === "rename-submit" ? "Release title" : "Feature name").setTextInputComponent(input));
}

function management(release: Release, messageId: string) {
	const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
	if (!release.closed && release.features.length) {
		for (const action of ["edit", "remove"]) {
			components.push(
				new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
					new StringSelectMenuBuilder()
						.setCustomId(`${PREFIX}${action}:${messageId}`)
						.setPlaceholder(action === "edit" ? "Edit a feature…" : "Remove a feature…")
						.addOptions(release.features.map((f) => ({ label: f.name.slice(0, 100), value: f.id }))),
				),
			);
		}
	}
	components.push(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}rename:${messageId}`).setLabel("Rename release").setStyle(ButtonStyle.Secondary).setDisabled(release.closed),
			new ButtonBuilder()
				.setCustomId(`${PREFIX}archive:${messageId}:${release.closed ? 0 : 1}`)
				.setLabel(release.closed ? "Reopen release" : "Archive release")
				.setStyle(ButtonStyle.Secondary),
		),
	);
	return {
		content: `**${escapeMarkdown(release.title)}**\n${release.closed ? "This release is archived. Reopen it to make changes." : "Manage this release. Removing a feature takes effect immediately."}`,
		components,
		allowedMentions: { parse: [] as [] },
	};
}

export default function ReleaseChecklist(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "release") {
			try {
				await interaction.reply(renderRelease({ title: releaseName(interaction.options.getString("title", true)), closed: false, features: [] }));
			} catch (error) {
				console.error("Release creation failed", error);
				if (!interaction.replied)
					await interaction.reply({
						content: "Could not create the release. Use a title on a single line and check the bot can send messages here.",
						flags: MessageFlags.Ephemeral,
					});
			}
			return;
		}
		if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith(PREFIX)) return;
		await handle(interaction)
			.catch(async (error) => {
				console.error("Release checklist interaction failed", error);
				const content = error instanceof Error ? error.message : "Could not update this release. Please try again.";
				if (interaction.deferred && canUpdateSource(interaction)) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
				else if (interaction.deferred) await interaction.editReply({ content });
				else if (interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
				else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
			})
			.catch((error) => console.error("Release checklist response failed", error));
	});

	async function handle(interaction: ChecklistInteraction) {
		const [action, ref, value] = interaction.customId.slice(PREFIX.length).split(":");
		const onCard = action === "add" || action === "manage" || action === "ready";
		const messageId = onCard && !interaction.isModalSubmit() ? interaction.message.id : ref;
		const viewing = ["add", "manage", "edit", "rename"].includes(action);
		const managementAction = ["remove", "archive", "edit-submit", "rename-submit"].includes(action);
		const updateSource = canUpdateSource(interaction);
		const sourceCard = updateSource && interaction.message?.id === messageId;
		// Public-card actions can reply directly. Management actions need to retrieve
		// the separate public message, so overlap that fetch with acknowledgement.
		const acknowledgement =
			viewing || sourceCard ? Promise.resolve() : updateSource ? interaction.deferUpdate() : interaction.deferReply({ flags: MessageFlags.Ephemeral });
		try {
			const [message] = await Promise.all([sourceCard ? Promise.resolve(interaction.message!) : fetchCard(), acknowledgement]);
			if (message.author.id !== client.user?.id) throw new Error("This checklist does not belong to this bot.");
			const release = readRelease(message.components.map((c) => c.toJSON()) as APIContainerComponent[]);
			if (action === "manage") {
				await interaction.reply({ ...management(release, messageId), flags: MessageFlags.Ephemeral });
				return;
			}
			if (release.closed && action !== "archive") throw new Error("This release is archived. Reopen it through Manage release to make changes.");
			if ((action === "add" || action === "rename") && interaction.isButton()) {
				await interaction.showModal(nameModal(action === "add" ? "add-submit" : "rename-submit", messageId, action === "rename" ? release.title : ""));
				return;
			}
			const featureId = action === "ready" ? ref : interaction.isStringSelectMenu() ? interaction.values[0] : value;
			const feature = release.features.find((f) => f.id === featureId);
			if (["ready", "edit", "remove", "edit-submit"].includes(action) && !feature) throw new Error("That feature has been removed. Open Manage release again.");
			if (action === "edit" && interaction.isStringSelectMenu()) {
				await interaction.showModal(nameModal("edit-submit", messageId, feature!.name, featureId));
				return;
			}
			if (action === "ready") feature!.ready = value === "0";
			else if (action === "remove") release.features = release.features.filter((f) => f.id !== featureId);
			else if (action === "archive") release.closed = value === "1";
			else if (interaction.isModalSubmit()) {
				const name = releaseName(interaction.fields.getTextInputValue("name"));
				if (action === "add-submit") release.features.push({ id: randomUUID(), name, ready: false });
				else if (action === "edit-submit") feature!.name = name;
				else if (action === "rename-submit") release.title = name;
				else throw new Error("Unknown checklist action.");
			} else throw new Error("Unknown checklist action.");
			if (!managementAction && sourceCard && (!interaction.isModalSubmit() || interaction.isFromMessage())) {
				// Ready/add interactions originate on the public card: the response IS the edit.
				await interaction.update(renderRelease(release));
			} else {
				await message.edit(renderRelease(release));
				await interaction.editReply(managementAction ? management(release, messageId) : { content: "Release updated." });
			}
		} catch (error) {
			// A fetch can fail while acknowledgement is still in flight. Wait before
			// the outer error handler decides between a reply and a follow-up.
			await acknowledgement.catch(() => {});
			throw error;
		}

		async function fetchCard() {
			const channel = interaction.channel;
			if (!channel || !("messages" in channel)) throw new Error("The release channel is unavailable.");
			// MessageManager returns a complete cached message, fetching only on a cache miss.
			return channel.messages.fetch({ message: messageId });
		}
	}
}
