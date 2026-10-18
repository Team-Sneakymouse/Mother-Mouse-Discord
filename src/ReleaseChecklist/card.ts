import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	ContainerBuilder,
	MessageFlags,
	SectionBuilder,
	TextDisplayBuilder,
	type APIContainerComponent,
} from "discord.js";

export interface ReleaseFeature {
	id: string;
	name: string;
	ready: boolean;
}
export interface Release {
	title: string;
	closed: boolean;
	features: ReleaseFeature[];
}
// Container + heading + 3 components per feature + footer row and two buttons <= 40.
export const MAX_FEATURES = 11;
export const PREFIX = "release:v1:";
const escape = (text: string) => text.replace(/[\\`*_~|[\]()#>+-]/g, "\\$&");
const unescape = (text: string) => text.replace(/\\(.)/g, "$1");

export function releaseName(value: string): string {
	const name = value.trim();
	if (!name || name.length > 120 || /[\r\n]/.test(name)) throw new Error("Use a name of 1–120 characters on a single line.");
	return name;
}

export function renderRelease(release: Release) {
	if (release.features.length > MAX_FEATURES) throw new Error(`This card can hold up to ${MAX_FEATURES} features. Remove a feature before adding another.`);
	const allReady = release.features.length > 0 && release.features.every((feature) => feature.ready);
	const card = new ContainerBuilder()
		.setAccentColor(release.closed ? 0x808080 : allReady ? 0x2ecc71 : 0xf1c40f)
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`## ${escape(releaseName(release.title))}\n${release.features.filter((f) => f.ready).length} of ${release.features.length} features ready${release.closed ? " · Archived" : ""}`,
			),
		);
	if (!release.features.length) card.addTextDisplayComponents(new TextDisplayBuilder().setContent("No features yet. Add the first feature below."));
	for (const feature of release.features) {
		card.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${feature.ready ? "🟢" : "🟡"} ${escape(releaseName(feature.name))}`))
				.setButtonAccessory(
					new ButtonBuilder()
						.setCustomId(`${PREFIX}ready:${feature.id}:${feature.ready ? 1 : 0}`)
						.setLabel(feature.ready ? "Mark unready" : "Mark ready")
						.setStyle(feature.ready ? ButtonStyle.Secondary : ButtonStyle.Success)
						.setDisabled(release.closed),
				),
		);
	}
	card.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`${PREFIX}add`).setLabel("Add feature").setStyle(ButtonStyle.Primary).setDisabled(release.closed),
			new ButtonBuilder()
				.setCustomId(`${PREFIX}manage:${release.closed ? 1 : 0}`)
				.setLabel("Manage release")
				.setStyle(ButtonStyle.Secondary),
		),
	);
	return { flags: MessageFlags.IsComponentsV2 as const, components: [card.toJSON()], allowedMentions: { parse: [] as [] } };
}

export function readRelease(components: APIContainerComponent[]): Release {
	const card = components[0];
	if (card?.type !== ComponentType.Container) throw new Error("This is not a release checklist.");
	const heading = card.components[0];
	const footer = card.components.at(-1);
	if (heading?.type !== ComponentType.TextDisplay || footer?.type !== ComponentType.ActionRow) throw new Error("Invalid release checklist.");
	const manage = footer.components.find((c) => c.type === ComponentType.Button && "custom_id" in c && c.custom_id.startsWith(`${PREFIX}manage:`));
	if (!manage || !("custom_id" in manage)) throw new Error("Invalid release checklist version.");
	const features: ReleaseFeature[] = [];
	for (const section of card.components) {
		if (section.type !== ComponentType.Section) continue;
		const button = section.accessory;
		const match = button.type === ComponentType.Button && "custom_id" in button && button.custom_id.match(/^release:v1:ready:([\w-]+):([01])$/);
		if (!match) throw new Error("Invalid release feature.");
		features.push({ id: match[1], name: unescape(section.components[0].content.slice(3)), ready: match[2] === "1" });
	}
	return { title: unescape(heading.content.split("\n")[0].slice(3)), closed: manage.custom_id.endsWith(":1"), features };
}

/** Serialize fetch/edit pairs in this bot process; no release data is retained here. */
export function createReleaseQueue() {
	const pending = new Map<string, Promise<unknown>>();
	return async <T>(id: string, work: () => Promise<T>): Promise<T> => {
		const previous = pending.get(id) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(work);
		pending.set(id, next);
		try {
			return await next;
		} finally {
			if (pending.get(id) === next) pending.delete(id);
		}
	};
}
