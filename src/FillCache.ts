import { Client } from "discord.js";

export default function FillCache(client: Client) {
	client.on("ready", async () => {
		const rawbtvGuild = client.guilds.cache.get("391355330241757205");
		if (!rawbtvGuild) return console.log("fillcache - unknown guild");
		for (const channel of rawbtvGuild.channels.cache.values()) {
			if (channel.isTextBased()) {
				let cacheMax = 1000;
				let cacheSize = 0;
				let lastMessageId = channel.lastMessageId ?? undefined;
				while (cacheSize < cacheMax) {
					const messages = await channel.messages.fetch({
						limit: 100,
						after: lastMessageId,
					});
					if (messages.size === 0) break;
					cacheSize += messages.size;
					lastMessageId = messages.lastKey();
				}
			}
		}
	});
}
