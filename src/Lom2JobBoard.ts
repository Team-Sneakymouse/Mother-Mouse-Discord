import { Client, EmbedBuilder, TextChannel, ChannelType } from "discord.js";
import { hooksConfig, hooksApi, type JobData, type Claim } from "./JobHooks.js";
import { deliver, deliveryStore, startPolling, type DeliveryStore } from "./JobDelivery.js";

const jobChannelId = "1233508899630481408";

function decodeBase64Image(base64String: string, fileName: string) {
	// Remove the prefix if present
	const dataStart = base64String.indexOf("base64,") + "base64,".length;
	const base64Data = base64String.substring(dataStart);

	const response: any = {};

	// Decode the base64 string
	response.data = Buffer.from(base64Data, "base64");
	response.fileName = fileName;

	return response;
}

function worldNameFromLocation(location: string): string | undefined {
	// CraftWorld{name=world} (Bukkit/Paper)
	const craftWorldName = /CraftWorld\{[^}]*\bname=([\w-]+)/.exec(location)?.[1];
	if (craftWorldName) return craftWorldName;

	// CraftWorld{key=minecraft:overworld}
	const worldKey = /(?:^|[,{])key=([a-z0-9_.:-]+)/i.exec(location)?.[1];
	if (worldKey) {
		switch (worldKey) {
			case "minecraft:overworld":
				return "world";
			case "minecraft:the_nether":
				return "world_nether";
			case "minecraft:the_end":
				return "world_the_end";
			default:
				return worldKey.includes(":") ? worldKey.split(":")[1] : worldKey;
		}
	}

	// Legacy custom format: name=<world> ... x=...
	return /\bname=([\w-]+).*?\bx=/.exec(location)?.[1];
}

function buildMapUrl(location: string): string | undefined {
	// Supports both legacy `name=world,x=...,y=...,z=...` and Bukkit Location.toString()
	const coords = /(?:^|[,{])x=([-\d.]+)(?:,|\s)*y=([-\d.]+)(?:,|\s)*z=([-\d.]+)/.exec(location);
	if (!coords) return undefined;

	const [, x, y, z] = coords;
	const world = worldNameFromLocation(location);
	if (!world) return undefined;

	// Determine the map name based on the Y value
	const mapName = parseFloat(y) < 215 ? "surface2" : "surface";

	return `https://lords.rawb.tv/map/#?worldname=${world}&mapname=${mapName}&zoom=4&x=${Math.round(parseFloat(x))}&y=${Math.round(
		parseFloat(y),
	)}&z=${Math.round(parseFloat(z))}`;
}

const marker = (id: string) => `[lom-job:${id}]`;
/** Bound Discord waits. A timed-out send remains reserved; never retry it blindly. */
async function bounded<T>(work: () => Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(Error("Job-board Discord deadline")), 15000);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
export async function processJobClaim(
	item: Claim,
	channel: TextChannel,
	store: DeliveryStore,
	ack: (item: Claim, id?: string) => Promise<void>,
	botId: string,
	guard: () => void = () => {},
) {
	guard();
	if (item.job.serverPort !== 50001) throw Error("Non-live job rejected");
	const job = item.job;
	const known = async () => job.discordMessageId || (await store.lookup(job.id));
	const lookup = async () => {
		const id = await known();
		if (id) return id;
		guard();
		const messages = await bounded(() => channel.messages.fetch({ limit: 100 }));
		const matches = [...messages.values()].filter((message) => message.author.id === botId && message.content === marker(job.id));
		if (matches.length > 1) throw Error("Multiple job markers: manual reconciliation required");
		const recovered = matches[0]?.id;
		if (recovered) {
			guard();
			await store.reserve(job.id);
			await store.save(job.id, recovered);
		}
		return recovered;
	};
	const acknowledge = async (id?: string) => {
		guard();
		await ack(item, id);
	};
	if (item.kind === "create") {
		await deliver({
			lookup,
			reserve: async () => {
				guard();
				return store.reserve(job.id);
			},
			send: async () => {
				guard();
				if (!job.posterIconBase64) throw Error("Missing job poster image");
				const icon = decodeBase64Image(job.posterIconBase64, "posterIcon.png");
				const embed = new EmbedBuilder()
					.setTitle(job.name)
					.addFields({ name: job.posterDisplayString, value: job.description })
					.setColor(0x247db9)
					.setTimestamp(job.startTime)
					.setThumbnail("attachment://posterIcon.png")
					.setAuthor({ iconURL: job.discordEmbedIcon, name: job.category })
					.setFooter({ text: job.locationDisplayString });
				const url = buildMapUrl(job.location);
				if (url) embed.setURL(url);
				const message = await bounded(() =>
					channel.send({
						content: marker(job.id),
						embeds: [embed],
						files: [{ attachment: icon.data, name: "posterIcon.png" }],
						allowedMentions: { parse: [] },
					}),
				);
				await store.save(job.id, message.id);
				return message.id;
			},
			ack: acknowledge,
		});
		return;
	}
	if (job.endTime <= 0) throw Error("Invalid end event");
	const id = await lookup();
	if (!id) {
		await acknowledge();
		return;
	}
	guard();
	try {
		const message = await bounded(() => channel.messages.fetch(id));
		if (message.author.id !== botId) throw Error("Job message is not owned by this bot");
		guard();
		if (job.endReason === "deleted") await bounded(() => message.delete());
		else {
			const old = message.embeds[0];
			if (!old) throw Error("Job message has no embed");
			const embed = new EmbedBuilder()
				.setTitle(old.title)
				.addFields({ name: job.posterDisplayString, value: job.description })
				.setColor(0x808080)
				.setTimestamp(job.startTime)
				.setThumbnail("attachment://posterIcon.png")
				.setAuthor({ iconURL: job.discordEmbedIcon, name: `${job.category} (Expired)` })
				.setFooter({ text: job.locationDisplayString });
			await bounded(() => message.edit({ embeds: [embed], allowedMentions: { parse: [] } }));
		}
	} catch (error) {
		if ((error as { code?: number }).code !== 10008) throw error;
	}
	await acknowledge();
}

export default function Lom2JobBoard(client: Client, env: NodeJS.ProcessEnv = process.env) {
	const config = hooksConfig(env); // Fail visibly rather than silently retaining PocketBase.
	const abort = new AbortController();
	const api = hooksApi(config, abort.signal);
	let stopPolling: (() => Promise<void>) | undefined;
	let startup: Promise<void> | undefined;
	let stopped = false;
	const start = () => {
		if (startup || stopped) return;
		startup = (async () => {
			const store = await deliveryStore(config.stateDir);
			if (stopped) return;
			stopPolling = startPolling(
				async () => {
					if (stopped) return;
					const batch = await api.claim();
					if (stopped) return;
					for (const item of batch.items) {
						const deadline = Date.now() + 90000;
						const guard = () => {
							if (stopped || Date.now() >= deadline) throw Error("Job-board stopped or event deadline exceeded");
						};
						guard();
						const channel = client.channels.cache.get(jobChannelId) ?? (await bounded(() => client.channels.fetch(jobChannelId)));
						if (!channel || channel.type !== ChannelType.GuildText) throw Error("Job-board channel is unavailable or not guild text");
						if (!client.user) throw Error("Job-board bot identity unavailable");
						await processJobClaim(item, channel as TextChannel, store, api.ack, client.user.id, guard);
					}
				},
				(error) => console.error("LoM2 job board delivery failed:", error),
			);
		})().catch((error) => console.error("LoM2 job board startup failed:", error));
	};
	if (client.isReady()) start();
	else client.once("clientReady", start);
	const stop = async () => {
		stopped = true;
		abort.abort();
		client.off("clientReady", start);
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await startup;
		await stopPolling?.();
	};
	const onSignal = () => {
		void stop();
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	return stop;
}
