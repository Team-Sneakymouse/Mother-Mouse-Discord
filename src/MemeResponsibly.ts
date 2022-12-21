import { Client, AttachmentBuilder } from "discord.js";
import axios from "axios";
import { Stream } from "node:stream";

export default async function MemeResponsibly(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guildId) return;
		if (message.author.bot) return;
		if (!message.content.match(/\bmeme\sresponsibly\b/i)) return;

		try {
			const res = await axios({
				method: "get",
				url: "https://i.danidipp.com/-tIhc.mp3",
				responseType: "stream",
			});

			if (res.status !== 200) return;

			await message.channel.send({
				content: "\u00A0",
				files: [new AttachmentBuilder(res.data as Stream).setName("meme-responsibly.mp3")],
			});
		} catch (e) {
			console.error(e);
		}
	});
}
