import { Client, AttachmentBuilder } from "discord.js";

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
				await message.channel.send({
					content: "\u00A0",
					files: [new AttachmentBuilder(url.href).setName(url.pathname.split("/").pop()!)],
				});
				message.delete();
			} catch (e) {
				console.error(`${(e as Error).message} (${url.href})`);
			}
		}
	});
}
