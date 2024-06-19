import {
	ChannelType,
	Client,
	ForumChannel,
	GuildBasedChannel,
	NewsChannel,
	TextBasedChannel,
	TextChannel,
	ThreadChannel,
} from "discord.js";

export default function FillCache(client: Client) {
	client.on("ready", async () => {
		const rawbtvGuild = client.guilds.cache.get("391355330241757205");
		if (!rawbtvGuild) return console.log("fillcache - unknown guild");
		for (const channel of rawbtvGuild.channels.cache.values()) {
			if (channel.type === ChannelType.GuildCategory) continue;
			if (channel.type === ChannelType.GuildMedia) continue;
			// skip channels in hidden categories
			if (channel.parent && channel.parent.permissionsFor(channel.guildId)?.has("ViewChannel") === false) continue;

			if (channel.isTextBased()) await cacheMessages(client, channel);
			if (hasTheads(channel)) {
				const archiveCuttoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90); // 90 days
				await (channel as TextChannel).threads.fetchActive();
				await (channel as TextChannel).threads.fetchArchived({ before: archiveCuttoff });
				for (const thread of channel.threads.cache.values()) await cacheMessages(client, thread);
			}
		}
	});
}

function hasTheads(channel: GuildBasedChannel): channel is NewsChannel | TextChannel | ForumChannel {
	return [ChannelType.GuildAnnouncement, ChannelType.GuildText, ChannelType.GuildForum].includes(channel.type);
}

async function cacheMessages(client: Client, channel: TextBasedChannel | ThreadChannel) {
	const fetchLimit = 100;
	const cacheMax = fetchLimit * 2;
	let cacheSize = 0;
	let lastMessageId = channel.lastMessageId ?? undefined;
	while (cacheSize < cacheMax) {
		const messages = await channel.messages.fetch({
			limit: fetchLimit,
			after: lastMessageId,
		});
		if (messages.size === 0) break;
		cacheSize += messages.size;
		lastMessageId = messages.last()?.id;
		if (messages.size < fetchLimit) break;
	}
}
