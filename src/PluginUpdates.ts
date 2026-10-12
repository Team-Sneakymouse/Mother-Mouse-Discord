import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	type Client,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
} from "discord.js";
import { PluginDeployment } from "./utils/PluginDeployment.js";

const RAWBTV = "391355330241757205";
const busy = new Set<string>();
export const data = [
	new SlashCommandBuilder()
		.setName("plugins")
		.setDescription("Deploy the latest Minecraft plugin and mod releases")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand((command) => command.setName("update").setDescription("Select a Lords of Minecraft server and releases to upload")),
];

export default function PluginUpdates(client: Client): void {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand() || interaction.commandName !== "plugins") return;
		if (interaction.guildId !== RAWBTV || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply({ content: "Only RAWBTV administrators can deploy releases.", flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.deferReply();
		try {
			await run(interaction);
		} catch (error) {
			await interaction.editReply({ content: "Deployment stopped.", components: [] });
			await interaction.followUp({
				content: `Deployment stopped: ${error instanceof Error ? error.message : "Unexpected error"}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	});
}

function navigation(page: number, pages: number, canUpload: boolean, plugins: boolean): ActionRowBuilder<ButtonBuilder> {
	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId("previous")
			.setLabel("Previous")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page === 0),
		new ButtonBuilder()
			.setCustomId("next")
			.setLabel("Next")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(page >= pages - 1),
	);
	if (plugins) row.addComponents(new ButtonBuilder().setCustomId("upload").setLabel("Upload selected").setStyle(ButtonStyle.Primary).setDisabled(!canUpload));
	return row.addComponents(new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary));
}

async function run(interaction: ChatInputCommandInteraction): Promise<void> {
	const host = process.env.PELICAN_API_HOST;
	const applicationKey = process.env.PELICAN_APLICATION_KEY;
	const clientKey = process.env.PELICAN_CLIENT_KEY;
	if (!host || !applicationKey || !clientKey) throw new Error("PELICAN_API_HOST, PELICAN_APLICATION_KEY and PELICAN_CLIENT_KEY must be configured");
	const deployment = new PluginDeployment(host, applicationKey, clientKey);
	const [servers, catalog] = await Promise.all([deployment.servers(), deployment.catalog()]);
	if (!servers.length) throw new Error("No accessible servers have Lords of Minecraft in their description");
	if (!catalog.artifacts.length)
		throw new Error(`No eligible releases found${catalog.failures.length ? ` (${catalog.failures.length} artifacts could not be read)` : ""}`);
	let page = 0;
	let server: (typeof servers)[number] | undefined;
	const selected = new Set<string>();
	const deadline = Date.now() + 10 * 60_000;
	while (true) {
		const options = server ? catalog.artifacts : servers;
		const pages = Math.ceil(options.length / 25);
		const visible = options.slice(page * 25, (page + 1) * 25);
		const menu = new StringSelectMenuBuilder()
			.setCustomId(server ? "artifacts" : "server")
			.setPlaceholder(server ? "Select plugins and mods" : "Select a server")
			.setMinValues(server ? 0 : 1)
			.setMaxValues(server ? visible.length : 1)
			.addOptions(
				server
					? catalog.artifacts.slice(page * 25, (page + 1) * 25).map((artifact) => ({
							label: artifact.id.slice(0, 100),
							value: artifact.id,
							description: `${artifact.version} · ${artifact.type}`.slice(0, 100),
							default: selected.has(artifact.id),
						}))
					: servers.slice(page * 25, (page + 1) * 25).map((item) => ({ label: item.name.slice(0, 100), value: item.identifier })),
			);
		const message = await interaction.editReply({
			content: `${server ? `**${server.name}** — ${selected.size} selected. Latest releases will be uploaded; older published versions will be removed. No restart.` : "Choose a Lords of Minecraft server."}\nPage ${page + 1}/${pages}${catalog.failures.length ? `\nWarning: ${catalog.failures.length} artifacts could not be read and are omitted.` : ""}`,
			components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu), navigation(page, pages, selected.size > 0, !!server)],
		});
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		const component = await message.awaitMessageComponent({ filter: (event) => event.user.id === interaction.user.id, time: remaining }).catch(() => undefined);
		if (!component) break;
		if (component.guildId !== RAWBTV || !component.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
			await component.reply({ content: "Administrator permission is required.", flags: MessageFlags.Ephemeral });
			await interaction.editReply({ content: "Deployment cancelled: administrator permission is required.", components: [] });
			return;
		}
		await component.deferUpdate();
		if (component.customId === "cancel") {
			await interaction.editReply({ content: "Deployment cancelled.", components: [] });
			return;
		}
		if (component.customId === "previous") page = Math.max(0, page - 1);
		else if (component.customId === "next") page = Math.min(pages - 1, page + 1);
		else if (component.isStringSelectMenu() && component.customId === "server") {
			server = servers.find((item) => item.identifier === component.values[0]);
			page = 0;
		} else if (component.isStringSelectMenu() && component.customId === "artifacts") {
			for (const artifact of catalog.artifacts.slice(page * 25, (page + 1) * 25)) selected.delete(artifact.id);
			for (const id of component.values) if (catalog.artifacts.some((artifact) => artifact.id === id)) selected.add(id);
		} else if (component.customId === "upload" && server && selected.size) {
			if (busy.has(server.identifier)) throw new Error("Another deployment is already running for this server");
			busy.add(server.identifier);
			try {
				const results: string[] = [];
				const failures: string[] = [];
				for (const id of selected) {
					await interaction.editReply({
						content: `Uploading **${id}** to **${server.name}** (${results.length + failures.length + 1}/${selected.size})…`,
						components: [],
					});
					try {
						const artifact = await deployment.deploy(server.identifier, id);
						results.push(`✓ ${id} ${artifact.version} → ${artifact.type === "paper-plugin" ? "plugins/.update/" : "mods/"}`);
					} catch (error) {
						failures.push(`✗ ${id}: ${error instanceof Error ? error.message : "Unexpected error"}`);
					}
				}
				// Follow-ups keep large, paginated selections within Discord's message limit.
				await interaction.editReply({
					content: `Deployment finished for **${server.name}**: ${results.length} succeeded, ${failures.length} failed. Server restart is up to you.`,
					components: [],
				});
				for (const [messages, privateReply] of [
					[results, false],
					[failures, true],
				] as const) {
					let chunk = "";
					for (const result of messages) {
						if ((chunk + result).length > 1900) {
							await interaction.followUp({ content: chunk, ...(privateReply ? { flags: MessageFlags.Ephemeral } : {}) });
							chunk = "";
						}
						chunk += `${result}\n`;
					}
					if (chunk) await interaction.followUp({ content: chunk, ...(privateReply ? { flags: MessageFlags.Ephemeral } : {}) });
				}
			} finally {
				busy.delete(server.identifier);
			}
			return;
		}
	}
	await interaction.editReply({ content: "Deployment selection expired. Run /plugins update again.", components: [] });
}
