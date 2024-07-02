import { Client, AttachmentBuilder } from "discord.js";

export default async function MemeResponsibly(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guildId) return;
		if (message.author.bot) return;
		if (!message.content.match(/\bmeme\sresponsibly\b/i)) return;

		try {
			await message.channel.send({
				content: "\u00A0",
				files: [new AttachmentBuilder("https://i.danidipp.com/-tIhc.mp3").setName("meme-responsibly.mp3")],
			});
		} catch (e) {
			console.error(e);
		}
	});
}
