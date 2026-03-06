import { Client, AttachmentBuilder, MessageFlags, MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder } from "discord.js";

export default function BlockbenchDownloader(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.author.bot) return;

		if (message.content.match(/https:\/\/blckbn.ch\//)) {
			const links = message.content.match(/https:\/\/blckbn.ch\/[a-zA-Z0-9]+/g);
			if (!links) return;

			message.channel.sendTyping();

			const codes = links.map((link) => link.replace(/\/$/, "").split("/").pop());
			const attachments: AttachmentBuilder[] = [];
			for (const code of codes) {
				let json;
				try {
					json = await fetch(`https://blckbn.ch/api/models/${code}`).then((res) => res.json());
				} catch (e) {
					console.error("Failed to fetch blockbench model", code);
					console.error(e);
					continue;
				}
				const name = json.name || code;
				attachments.push(
					new AttachmentBuilder(`https://blckbn.ch/api/models/${code}`).setName(`${name}.bbmodel`),
					new AttachmentBuilder(`https://blckbn.ch/thumb/${code}.png`).setName(`${name}.png`),
				);
			}
			if (attachments.length === 0) return;

			await message.channel.send({
				flags: MessageFlags.IsComponentsV2,
				components: [
					new MediaGalleryBuilder().addItems(...attachments
						.filter(a => a.name?.endsWith(".png"))
						.map(a => new MediaGalleryItemBuilder()
							.setURL(`attachment://${a.name}`)
							.setDescription(a.name || "unknown.png")
						)
					),
					...attachments.filter(a => a.name?.endsWith(".bbmodel"))
						.map(a => new FileBuilder().setURL(`attachment://${a.name}`))
				],
				files: attachments,
				reply: { messageReference: message },
				allowedMentions: { repliedUser: false },
			});
		}
	});
}
