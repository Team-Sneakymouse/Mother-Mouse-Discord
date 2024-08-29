import { Client, AttachmentBuilder, MessageFlags } from "discord.js";

export default function BlockbenchDownloader(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.author.bot) return;

		if (message.content.match(/https:\/\/blckbn.ch\//)) {
			const links = message.content.match(/https:\/\/blckbn.ch\/[a-zA-Z0-9]+/g);
			if (!links) return;

			message.channel.sendTyping();

			const codes = links.map((link) => link.replace(/\/$/, "").split("/").pop());
			const attachments = [];
			for (const code of codes) {
				let json;
				try {
					json = await fetch(`https://www.blckbn.ch/api/models/${code}`).then((res) => res.json());
				} catch (e) {
					console.error("Failed to fetch blockbench model", code);
					console.error(e);
					continue;
				}
				const name = json.name || code;
				attachments.push(new AttachmentBuilder(`https://www.blckbn.ch/api/models/${code}`).setName(`${name}.bbmodel`));
			}
			if (attachments.length === 0) return;

			await message.channel.send({
				content: "\u00A0",
				files: attachments,
				reply: { messageReference: message },
				allowedMentions: { repliedUser: false },
			});
		}
	});
}
