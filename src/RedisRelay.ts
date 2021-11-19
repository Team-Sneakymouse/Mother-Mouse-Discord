import { Client } from "discord.js";
import { Redis } from "ioredis";

export default function RedisRelay(client: Client, redis: Redis) {
	client.on("messageCreate", async (message) => {
		if (message.author.bot) return;
		if (!message.channelId) return;
		if (message.channelId !== "911354514404171787") return;
		if (!message.content.startsWith("!redis ")) return;

		const [, command, ...args] = message.content.split(" ");
		try {
			console.log(`Executing Redis command: ${[command, ...args].join(" ")}`);
			const result = await redis.send_command(command, args);
			message.reply({
				content: "\u00A0",
				embeds: [
					{
						color: 0x00ff00,
						description: [command, ...args].join(" ") + "```json\n" + JSON.stringify(result, null, 2) + "\n```",
					},
				],
			});
		} catch (error) {
			message.reply({
				content: "\u00A0",
				embeds: [
					{
						color: 0xff0000,
						title: (error as Error).name,
						description: (error as Error).message + "```json\n" + JSON.stringify(error, null, 2) + "\n```",
					},
				],
			});
		}
	});
}
