import axios from "axios";
import { Client } from "discord.js";
import { createWriteStream, existsSync, promises } from "fs";
import { Redis } from "ioredis";
import { Stream } from "stream";

export default function GuessWho(client: Client, redis: Redis) {
	client.on("messageCreate", async (message): Promise<any> => {
		if (!message.channelId || message.channelId !== "910686787767250954" || message.author.bot) return;
		const attachments = message.attachments.map((attachment) => attachment.url);
		const matches = message.content.match(/\b(http[^\s]+)\b/gi) || [];

		const urls = [...attachments, ...matches];

		if (!urls.length) {
			const reply = await message.reply("No images found!");
			message.delete();
			await new Promise((resolve) => setTimeout(resolve, 5000));
			reply.delete();
			return;
		}

		const downloadPromises = urls.map((url, i) => downloadImage(url, message.author.username, i));
		await Promise.all(downloadPromises);

		const reply = await message.reply(`I got ${urls.length} image${urls.length > 1 ? "s" : ""} from this message <3`);
		message.delete();
		await new Promise((resolve) => setTimeout(resolve, 5000));
		reply.delete();
	});

	async function downloadImage(url: string, name: string, i: number = 0) {
		const res = await axios({
			method: "GET",
			url,
			responseType: "stream",
		});

		if (!existsSync(`./share/guesswho`)) {
			await promises.mkdir(`./share/guesswho`);
		}

		const time = new Date().toISOString().replace("T", " ").split(".")[0] + "-";
		const extension = url.split(".").pop();
		while (existsSync(`./share/guesswho/${time}${String(i)}.${extension}`)) {
			i++;
		}

		const file = createWriteStream(`./share/guesswho/${time}${String(i)}.${extension}`);
		(res.data as Stream).pipe(file);

		await new Promise((resolve) => {
			file.on("finish", resolve);
		});

		await redis.hset("guesswho", `${time}${String(i)}.${extension}`, name);
	}
}
