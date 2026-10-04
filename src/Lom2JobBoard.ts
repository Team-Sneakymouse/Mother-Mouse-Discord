import { Client, EmbedBuilder, TextChannel, ChannelType } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
import EventSource from "eventsource";

(global as any).EventSource = EventSource;

const jobChannelId = "1233508899630481408";

type JobData = {
	id: string;
	category: string;
	posterDisplayString: string;
	posterIconBase64: string;
	location: string;
	locationDisplayString: string;
	startTime: number;
	name: string;
	description: string;
	discordEmbedIcon: string;
	discordMessageId: string;
	endTime: number;
	endReason: string;
};

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
		parseFloat(y)
	)}&z=${Math.round(parseFloat(z))}`;
}

export default function Lom2JobBoard(client: Client, pocketBase: PocketBase) {
	const readyPromise = client.isReady() ? Promise.resolve() : new Promise<void>((resolve) => client.once("clientReady", () => resolve()));

	client.once("clientReady", () => {
		pocketBase
			.collection("lom2_listed_jobs")
			.subscribe("*", (e) => {
				console.log(`LoM2 job board: ${e.action} ${e.record.id}`);
				if (e.action === "create") void postJob(e.record);
				else if (e.action === "update") void expireJob(e.record);
			})
			.then(() => console.log("LoM2 job board: subscribed to lom2_listed_jobs"))
			.catch((error) => console.error("LoM2 job board subscribe failed:", error));
	});

	async function getJobChannel(): Promise<TextChannel | null> {
		await readyPromise;

		console.log(
			`LoM2 job board: resolving channel ${jobChannelId}; guilds=[${[...client.guilds.cache.values()]
				.map((g) => `${g.name}:${g.id}`)
				.join(", ")}]; cached=${client.channels.cache.has(jobChannelId)}`
		);

		let channel = client.channels.cache.get(jobChannelId) ?? null;
		if (!channel) {
			try {
				channel = await client.channels.fetch(jobChannelId);
			} catch (error) {
				console.error(`LoM2 job board: failed to fetch channel ${jobChannelId}:`, error);
				return null;
			}
		}

		if (!channel || channel.isDMBased() || !channel.isTextBased() || channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
			console.error(
				`LoM2 job board: channel ${jobChannelId} unusable (present=${Boolean(channel)}, type=${channel?.type})`
			);
			return null;
		}

		return channel as TextChannel;
	}

	async function postJob(record: RecordModel) {
		try {
			const {
				id,
				category,
				posterDisplayString,
				posterIconBase64,
				location,
				locationDisplayString,
				startTime,
				name,
				description,
				discordEmbedIcon,
			} = record as unknown as JobData;

			const jobChannel = await getJobChannel();
			if (!jobChannel) return;

			if (!posterIconBase64) {
				console.error(`LoM2 job board: job ${id} missing posterIconBase64`);
				return;
			}

			const posterIconData = decodeBase64Image(posterIconBase64, "posterIcon.png");
			const url = buildMapUrl(location ?? "");
			if (!url) {
				console.warn(`LoM2 job board: job ${id} location did not match map regex: ${location}`);
			}

			const embedBuilder = new EmbedBuilder()
				.setTitle(name)
				.addFields({ name: posterDisplayString, value: description })
				.setColor(0x247db9)
				.setTimestamp(startTime)
				.setThumbnail("attachment://posterIcon.png")
				.setAuthor({ iconURL: discordEmbedIcon, name: category })
				.setFooter({ text: locationDisplayString });

			// discord.js rejects empty URLs — only set when we parsed a map link
			if (url) embedBuilder.setURL(url);

			const message = await jobChannel.send({
				embeds: [embedBuilder],
				files: [{ attachment: posterIconData.data, name: "posterIcon.png" }],
			});

			await pocketBase.collection("lom2_listed_jobs").update(id, { discordMessageId: message.id });
			console.log(`LoM2 job board: posted job ${id} as message ${message.id}`);
		} catch (error) {
			console.error("LoM2 job board: error posting job:", error);
		}
	}

	async function expireJob(record: RecordModel) {
		try {
			const {
				category,
				posterDisplayString,
				locationDisplayString,
				startTime,
				description,
				discordEmbedIcon,
				discordMessageId,
				endTime,
				endReason,
			} = record as unknown as JobData;

			// Ignore the update that only stores discordMessageId after a create
			if (!discordMessageId || !endTime || endTime <= 0) return;

			const jobChannel = await getJobChannel();
			if (!jobChannel) return;

			const message = await jobChannel.messages.fetch(discordMessageId);

			if (endReason == "deleted") {
				await message.delete();
				console.log(`LoM2 job board: deleted message ${discordMessageId}`);
				return;
			}

			const oldEmbed = message.embeds[0];
			if (!oldEmbed) return;

			const embedBuilder = new EmbedBuilder()
				.setTitle(oldEmbed.title)
				.addFields({ name: posterDisplayString, value: description })
				.setColor(0x808080)
				.setTimestamp(startTime)
				.setThumbnail(oldEmbed.thumbnail?.url ?? null)
				.setAuthor({ iconURL: discordEmbedIcon, name: `${category} (Expired)` })
				.setFooter({ text: locationDisplayString })
				.setURL(null); // drop the dynmap link on expire

			await message.edit({ embeds: [embedBuilder] });
			console.log(`LoM2 job board: expired message ${discordMessageId}`);
		} catch (error) {
			console.error("LoM2 job board: error expiring job:", error);
		}
	}
}
