import { Client } from "discord.js";
import type YouTubeDL from "./utils/youtube-dl.js";

export default function YouTube(client: Client, ytdl: YouTubeDL) {
	client.on("messageCreate", async (message) => {
		if (message.channelId !== "990732990365720647") return;
		if (message.author.id === client.user!.id) return;

		const urls = message.content
			.split(/[\t\n\s]/)
			.map((u) => {
				try {
					return new URL(u);
				} catch (_) {
					return null;
				}
			})
			.filter((u) => !!u) as URL[];

		if (urls.length === 0) return;

		const reply = await message.reply("Getting info <a:typing:990723371522195526>");
		try {
			const progressUpdates = urls.map((_) => "waiting for start... 0%, ETA n/a");
			let lastUpdate = Date.now();
			function updateProgress() {
				if (Date.now() - lastUpdate < 2000) return;
				reply.edit(`Downloading <a:typing:990723371522195526>\n${progressUpdates.join("\n")}`);
				lastUpdate = Date.now();
			}
			const files = await Promise.all(
				urls.map((url, index) =>
					ytdl.download(url.href, (progress, eta) => {
						let bar = new Array(22)
							.fill(0)
							.map((_, i) => (i <= (progress * 22) / 100 ? "=" : " "))
							.join("");
						bar = "`[" + bar + "]`";
						progressUpdates[index] = `${bar} ${progress.toFixed(1)}%, ETA ${eta}`;
						updateProgress();
					})
				)
			);
			// console.log(file);
			await reply.edit("Uploading to Discord <a:typing:990723371522195526>");
			await reply.edit({
				content: "Done!",
				files,
			});
		} catch (e) {
			reply.edit("Error: " + (typeof e === "string" ? e : "\n```json\n" + JSON.stringify(e, null, 2) + "\n```"));
		}
	});
}
