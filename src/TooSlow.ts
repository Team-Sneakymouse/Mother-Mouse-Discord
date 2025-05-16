import { Client } from "discord.js";
import { Redis } from "ioredis";

export default function MediaEmbeds(client: Client, redis: Redis) {
	client.on("typingStart", async (typing) => {
		if (typing.inGuild()) return;
		if (!typing.channel.isSendable()) return;
		if (await redis.get(`mm-discord-tooslow:${typing.user.id}`)) return;

		await Promise.all([
			redis.set(`mm-discord-tooslow:${typing.user.id}`, "true", "EX", 900),
			typing.channel.send(`TOO SLOW! <:1robMyMan:805582449022337024> `),
		]);
	});
	client.on("messageCreate", async (message) => {
		if (message.guildId) return;
		await redis.set(`mm-discord-tooslow:${message.author.id}`, "true", "EX", 900);
	});
}
