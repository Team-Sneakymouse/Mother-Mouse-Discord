import { Client } from "discord.js";
import { Redis } from "ioredis";

export default function MediaEmbeds(client: Client, redis: Redis) {
	client.on("messageCreate", async (message) => {
		if (message.guildId !== "391355330241757205") return;
		if (!message.content.match(/kobold/i)) return;

		await redis.zincrby("mm-discord-stats:kobold", 1, message.author.id);
	});
}
