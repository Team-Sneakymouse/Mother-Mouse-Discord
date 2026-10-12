import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, type Message, StringSelectMenuBuilder } from "discord.js";
import type { Artifact, DeploymentType, Server } from "./PluginDeployment.js";

export type UpdateState = {
	owner: string;
	server?: { identifier: string; name: string };
	stage: "servers" | "select" | "upload";
	page: number;
	selected: string[];
	completed: { id: string; version: string; type: DeploymentType }[];
};
export const PREFIX = "plugin-update:";
const artifactId = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,99}$/;

export function customId(state: UpdateState, action: string): string {
	return `${PREFIX}${state.owner}:${state.server?.identifier ?? "-"}:${state.stage}:${state.page}:${action}`;
}

export function parseRoute(id: string) {
	const match = /^plugin-update:(\d+):([A-Za-z0-9-]+):(servers|select|upload):(\d+):(server|artifacts|previous|next|upload|retry|cancel)$/.exec(id);
	if (!match) throw new Error("This deployment message cannot be read. Run /plugins update again.");
	return { owner: match[1], server: match[2], stage: match[3] as UpdateState["stage"], page: Number(match[4]), action: match[5] };
}

export function readState(message: Pick<Message, "components" | "embeds">): UpdateState {
	const ids = message.components
		.flatMap((row) => (row.type === ComponentType.ActionRow ? row.components : []))
		.flatMap((component) => ("customId" in component && component.customId?.startsWith(PREFIX) ? [component.customId] : []));
	const route = parseRoute(ids[0] ?? "");
	const selected: string[] = [];
	const completed: UpdateState["completed"] = [];
	for (const field of message.embeds[0]?.fields ?? []) {
		if (field.name === "Selected releases") {
			for (const line of field.value.split("\n")) {
				const id = line.replace(/^`|`$/g, "");
				if (!artifactId.test(id)) throw new Error("Invalid selected artifact in deployment message");
				selected.push(id);
			}
		} else if (field.name === "Uploaded releases") {
			for (const line of field.value.split("\n")) {
				const match = /^`([^ ]+) ([^ ]+) (paper-plugin|ignite-mod)`$/.exec(line);
				if (!match || !artifactId.test(match[1])) throw new Error("Invalid upload result in deployment message");
				completed.push({ id: match[1], version: match[2], type: match[3] as DeploymentType });
			}
		}
	}
	if (new Set(selected).size !== selected.length || completed.some((item) => !selected.includes(item.id))) throw new Error("Invalid deployment selection");
	return {
		owner: route.owner,
		stage: route.stage,
		page: route.page,
		selected,
		completed,
		...(route.server === "-" ? {} : { server: { identifier: route.server, name: message.embeds[0]?.title ?? route.server } }),
	};
}

function fields(name: string, lines: string[]) {
	const result: { name: string; value: string }[] = [];
	let value = "";
	for (const line of lines) {
		if (line.length > 1024) throw new Error("Release name is too long for Discord");
		if (value && value.length + line.length + 1 > 1024) {
			result.push({ name, value });
			value = "";
		}
		value += `${value ? "\n" : ""}${line}`;
	}
	if (value) result.push({ name, value });
	return result;
}

export function pending(state: UpdateState): string[] {
	return state.selected.filter((id) => !state.completed.some((item) => item.id === id));
}

export function renderState(state: UpdateState, servers: Server[] = [], artifacts: Artifact[] = [], status?: string) {
	// Reserve room for completed versions before allowing a selection, not after uploading.
	if (state.selected.reduce((size, id) => size + 2 * id.length + 140, 0) > 5000)
		throw new Error("Too many selected releases for one Discord message. Deploy them in separate batches.");
	const embed = new EmbedBuilder()
		.setTitle((state.server?.name ?? "Minecraft release deployment").slice(0, 256))
		.setDescription(`Started by <@${state.owner}>`)
		.addFields(
			...fields(
				"Selected releases",
				state.selected.map((id) => `\`${id}\``),
			),
			...fields(
				"Uploaded releases",
				state.completed.map((item) => `\`${item.id} ${item.version.slice(0, 100)} ${item.type}\``),
			),
		);
	const controls = new ActionRowBuilder<ButtonBuilder>();
	const components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];
	let content = status ?? "Choose a Lords of Minecraft server.";
	if (state.stage === "upload") {
		content =
			status ??
			`Deployment has ${pending(state).length} unfinished release(s). Retry remaining after an interruption or failure. Restart the server yourself to apply uploads.`;
		if (pending(state).length)
			controls.addComponents(new ButtonBuilder().setCustomId(customId(state, "retry")).setLabel("Retry remaining").setStyle(ButtonStyle.Primary));
	} else {
		const count = state.stage === "servers" ? servers.length : artifacts.length;
		const pages = Math.max(1, Math.ceil(count / 25));
		state.page = Math.max(0, Math.min(state.page, pages - 1));
		const menu = new StringSelectMenuBuilder().setCustomId(customId(state, state.stage === "servers" ? "server" : "artifacts"));
		if (count) {
			menu.setPlaceholder(state.stage === "servers" ? "Select a server" : "Select plugins and mods");
			if (state.stage === "servers")
				menu
					.setMinValues(1)
					.setMaxValues(1)
					.addOptions(servers.slice(state.page * 25, (state.page + 1) * 25).map((server) => ({ label: server.name.slice(0, 100), value: server.identifier })));
			else {
				const visible = artifacts.slice(state.page * 25, (state.page + 1) * 25);
				menu
					.setMinValues(0)
					.setMaxValues(visible.length)
					.addOptions(
						visible.map((artifact) => ({
							label: artifact.id,
							value: artifact.id,
							description: `${artifact.version} · ${artifact.type}`.slice(0, 100),
							default: state.selected.includes(artifact.id),
						})),
					);
			}
			components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
		}
		controls.addComponents(
			new ButtonBuilder()
				.setCustomId(customId(state, "previous"))
				.setLabel("Previous")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(state.page === 0),
			new ButtonBuilder()
				.setCustomId(customId(state, "next"))
				.setLabel("Next")
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(state.page >= pages - 1),
		);
		if (state.stage === "select")
			controls.addComponents(
				new ButtonBuilder()
					.setCustomId(customId(state, "upload"))
					.setLabel("Upload selected")
					.setStyle(ButtonStyle.Primary)
					.setDisabled(!state.selected.length),
			);
		content = `${status ?? (state.stage === "select" ? `${state.selected.length} selected. Latest releases will be uploaded; older copies in the destination will be removed. No restart.` : content)}\nPage ${state.page + 1}/${pages}`;
	}
	if (state.stage !== "upload" || pending(state).length)
		controls.addComponents(new ButtonBuilder().setCustomId(customId(state, "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary));
	if (controls.components.length) components.push(controls);
	return { content, embeds: [embed], components, allowedMentions: { parse: [] as never[] } };
}

export function selectArtifacts(state: UpdateState, displayed: string[], values: string[]): void {
	if (values.some((id) => !displayed.includes(id))) throw new Error("Selection does not match this menu");
	state.selected = [...state.selected.filter((id) => !displayed.includes(id)), ...values];
}
