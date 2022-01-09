import { Client } from "discord.js";
import { Redis } from "ioredis";

export default function MediaEmbeds(client: Client, redis: Redis) {
	client.on("messageCreate", async (message) => {
		if (message.guildId !== "391355330241757205") return;
		redis.zincrby("mm-discord-stats:messages", 1, message.author.id);

		if (message.content.match(/kobold/i)) {
			redis.zincrby("mm-discord-stats:kobold", 1, message.author.id);
		}
	});
}
