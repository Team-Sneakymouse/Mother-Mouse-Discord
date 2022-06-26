import { Client } from "discord.js";
import type YouTubeDL from "./utils/youtube-dl";

export default function YouTube(client: Client, ytdl: YouTubeDL) {
	client.on("messageCreate", async (message) => {
		if (message.channelId !== "990732990365720647") return;

		try {
			let url = new URL(message.content);
		} catch (_) {
			return;
		}
		const reply = await message.reply("Getting info <a:typing:990723371522195526>");
		try {
			const file = await ytdl.download(message.content, (progress, eta) => {
				let bar = new Array(22)
					.fill(0)
					.map((_, i) => (i <= (progress * 22) / 100 ? "=" : " "))
					.join("");
				bar = "`[" + bar + "]`";
				reply.edit(`Downloading <a:typing:990723371522195526>\n${bar} ${progress.toFixed(1)}%, ETA ${eta}`);
			});
			console.log(file);
			const uploadingPromise = reply.edit("Uploading to Discord <a:typing:990723371522195526>");
			await reply.edit({
				content: "Done!",
				files: [file],
			});
		} catch (e) {
			reply.edit("Error: " + (typeof e === "string" ? e : "\n```json\n" + JSON.stringify(e, null, 2) + "\n```"));
		}
	});
}
