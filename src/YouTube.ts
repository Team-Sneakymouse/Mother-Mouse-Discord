import { Client } from "discord.js";
import type YouTubeDL from "./utils/youtube-dl";

export default function YouTube(client: Client, ytdl: YouTubeDL) {
	client.on("messageCreate", async (message) => {
		if (message.channelId !== "916742177994997770") return;

		try {
			let url = new URL(message.content);
		} catch (_) {
			console.log(_);
			return;
		}
		console.log("start");
		const file = await ytdl.download(message.content);
		console.log(file);
	});
}
