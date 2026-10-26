import { isDeepStrictEqual } from "node:util";
import {
	ComponentType,
	type ChatInputCommandInteraction,
	type Client,
	type Message,
	type MessageComponentInteraction,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import { compatible, PluginDeployment } from "./utils/PluginDeployment.js";
import { acquireDeploymentLock } from "./utils/DeploymentLock.js";
import { parseRoute, pending, PREFIX, readState, renderState, selectArtifacts, type UpdateState } from "./utils/PluginUpdateMessage.js";

const RAWBTV = "391355330241757205";
export const data = [
	new SlashCommandBuilder()
		.setName("plugins")
		.setDescription("Deploy the latest Minecraft plugin and mod releases")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand((command) => command.setName("update").setDescription("Select a Lords of Minecraft server and releases to upload")),
];

function deployment(): PluginDeployment {
	const host = process.env.PELICAN_API_HOST;
	const applicationKey = process.env.PELICAN_APPLICATION_KEY;
	const clientKey = process.env.PELICAN_CLIENT_KEY;
	if (!host || !applicationKey || !clientKey) throw new Error("PELICAN_API_HOST, PELICAN_APPLICATION_KEY and PELICAN_CLIENT_KEY must be configured");
	return new PluginDeployment(host, applicationKey, clientKey);
}

function snapshot(message: Message) {
	return {
		content: message.content,
		embeds: message.embeds.map((embed) => ({
			title: embed.title,
			description: embed.description,
			fields: embed.fields.map((field) => ({ name: field.name, value: field.value })),
		})),
		components: message.components.map((row) => ({
			type: row.type,
			controls:
				row.type === ComponentType.ActionRow
					? row.components.map((component) => ({
							type: component.type,
							customId: "customId" in component ? component.customId : null,
							disabled: "disabled" in component ? (component.disabled ?? false) : false,
							options: "options" in component ? component.options.map((option) => option.value) : [],
						}))
					: [],
		})),
	};
}

export class PluginUpdatesController {
	private messages = new Set<string>();
	constructor(private service: () => PluginDeployment = deployment) {}

	async command(interaction: ChatInputCommandInteraction): Promise<void> {
		// Discord authorizes slash command delivery, including server command permission overrides.
		if (interaction.guildId !== RAWBTV) {
			await interaction.reply({ content: "This command is only available in the RAWBTV server.", flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.deferReply();
		try {
			const servers = await this.service().servers();
			if (!servers.length) throw new Error("No accessible servers have Lords of Minecraft in their description");
			await interaction.editReply(renderState({ owner: interaction.user.id, stage: "servers", page: 0, selected: [], completed: [] }, servers));
		} catch (error) {
			await interaction.editReply({ content: "Deployment stopped due to error.", components: [] });
			await this.error(interaction, error);
		}
	}

	async component(interaction: MessageComponentInteraction): Promise<void> {
		if (!interaction.customId.startsWith(PREFIX)) return;
		try {
			const route = parseRoute(interaction.customId);
			// Persistent controls continue the authorized command, but only for its initiating user.
			if (interaction.message.author.id !== interaction.client.user.id || interaction.guildId !== RAWBTV || interaction.user.id !== route.owner) {
				await interaction.reply({
					content: "Only the user who started this deployment can use these controls in the RAWBTV server.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			if (this.messages.has(interaction.message.id)) {
				await interaction.reply({ content: "This deployment is already being processed.", flags: MessageFlags.Ephemeral });
				return;
			}
			this.messages.add(interaction.message.id);
			try {
				const clicked = snapshot(interaction.message);
				await interaction.deferUpdate();
				const message = await interaction.message.fetch(true);
				if (!isDeepStrictEqual(snapshot(message), clicked)) throw new Error("The deployment changed while you clicked. Use the updated controls.");
				const state = readState(message);
				if (route.action === "cancel") {
					await message.edit({ content: "Deployment cancelled.", components: [] });
					return;
				}
				const service = this.service();
				if (route.action === "reset") {
					const servers = await service.servers();
					if (!servers.length) throw new Error("No accessible servers have Lords of Minecraft in their description");
					await message.edit(renderState({ owner: state.owner, stage: "servers", page: 0, selected: [], completed: [] }, servers));
					return;
				}
				if ((route.action === "upload" && state.stage === "select") || (route.action === "retry" && state.stage === "upload")) {
					await this.upload(message, state, service, interaction);
					return;
				}
				if (state.stage === "upload") throw new Error("Use Retry remaining to continue this deployment");
				if (state.stage === "servers") {
					const servers = await service.servers();
					if (route.action === "server" && interaction.isStringSelectMenu()) {
						const server = servers.find((item) => item.identifier === interaction.values[0]);
						if (!server) throw new Error("Selected server is no longer in scope");
						state.server = { identifier: server.identifier, name: server.name };
						state.stage = "select";
						state.page = 0;
					} else {
						this.navigate(state, route.action);
						await message.edit(renderState(state, servers));
						return;
					}
				} else if (route.action === "artifacts" && interaction.isStringSelectMenu()) {
					// Use the options actually displayed, even if the Maven catalog has changed.
					const menu = message.components
						.flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
						.find((item) => "customId" in item && item.customId === interaction.customId);
					if (!menu || !("options" in menu)) throw new Error("Artifact menu is missing");
					selectArtifacts(
						state,
						menu.options.map((option) => option.value),
						interaction.values,
					);
				} else this.navigate(state, route.action);
				const [servers, catalog] = await Promise.all([service.servers(), service.catalog()]);
				const server = servers.find((item) => item.identifier === state.server?.identifier);
				if (!server) throw new Error("Selected server is no longer in scope");
				await message.edit(
					renderState(
						state,
						[],
						catalog.artifacts.filter((artifact) => compatible(artifact.types, server)),
						catalog.failures.length ? `${catalog.failures.length} artifacts could not be read and are omitted.` : undefined,
					),
				);
			} finally {
				this.messages.delete(interaction.message.id);
			}
		} catch (error) {
			await this.error(interaction, error);
		}
	}

	private navigate(state: UpdateState, action: string): void {
		if (action === "previous") state.page = Math.max(0, state.page - 1);
		else if (action === "next") state.page++;
		else throw new Error("This action does not match the current deployment stage");
	}

	private async upload(message: Message, state: UpdateState, service: PluginDeployment, interaction: MessageComponentInteraction): Promise<void> {
		if (!state.server || !pending(state).length) throw new Error("Select at least one unfinished release");
		const server = state.server.identifier;
		const release = acquireDeploymentLock(server);
		if (!release) throw new Error("Another deployment is already running for this server");
		try {
			state.stage = "upload";
			await message.edit(
				renderState(state, [], [], "Uploading releases. Retry remaining becomes available after an interruption; no server restart is performed."),
			);
			for (const id of pending(state)) {
				await message.edit(renderState(state, [], [], `Uploading **${id}** (${state.completed.length}/${state.selected.length} completed)…`));
				try {
					await service.deploy(server, id);
				} catch (error) {
					await this.error(interaction, new Error(`${id}: ${error instanceof Error ? error.message : "Unexpected error"}`));
					continue;
				}
				state.completed.push({ id });
				// Persist each success before starting the next artifact. Retrying an unrecorded success is safe.
				await message.edit(renderState(state, [], [], `${state.completed.length}/${state.selected.length} uploaded.`));
			}
			await message.edit(
				renderState(
					state,
					[],
					[],
					`Deployment finished: ${state.completed.length} uploaded, ${pending(state).length} unfinished. ${pending(state).length ? "Use Retry remaining to retry unfinished releases. " : ""}Restart the server yourself to apply uploads.`,
				),
			);
		} finally {
			release();
		}
	}

	private async error(interaction: ChatInputCommandInteraction | MessageComponentInteraction, error: unknown): Promise<void> {
		const reply = { content: error instanceof Error ? error.message : "Unexpected deployment error", flags: MessageFlags.Ephemeral as const };
		try {
			if (interaction.deferred || interaction.replied) await interaction.followUp(reply);
			else await interaction.reply(reply);
		} catch {
			// Long deployments may outlive the click's token. Their public progress and retry controls use the bot token.
			console.error(`PluginUpdates: private error response could not be sent: ${reply.content}`);
		}
	}
}

export default function PluginUpdates(client: Client): void {
	const controller = new PluginUpdatesController();
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "plugins") await controller.command(interaction);
		else if (interaction.isMessageComponent() && interaction.customId.startsWith(PREFIX)) await controller.component(interaction);
	});
}
