import axios from "axios";
import { Client, AttachmentBuilder } from "discord.js";
import { Stream } from "node:stream";

export default function MediaEmbeds(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.author.bot) return;

		if (message.content.match(/^http.*\.(mp3|wav|ogg)$/)) {
			let url;
			try {
				url = new URL(message.content);
			} catch (e) {
				return;
			}

			message.channel.sendTyping();

			try {
				const res = await axios({
					method: "get",
					url: url.href,
					responseType: "stream",
				});

				if (res.status !== 200) return;

				await message.channel.send({
					content: "\u00A0",
					files: [new AttachmentBuilder(res.data as Stream).setName(url.pathname.split("/").pop()!)],
				});
				message.delete();
			} catch (e) {
				console.error(`${(e as Error).message} (${url.href})`);
			}
		}
	});
}
