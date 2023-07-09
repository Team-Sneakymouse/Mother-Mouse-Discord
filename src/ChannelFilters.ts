import { Client } from "discord.js";

export default function ChannelFilters(client: Client) {
	client.on("messageCreate", (message) => {
		if (message.author.id === message.guild?.ownerId) return; // Server owner exempt

		if (message.guildId === "391355330241757205") {
			// rawb.tv
			if (message.channelId === "1096954434946347149") {
				// #-dvz-screenshots
				// Delete messages without attachments or links
				if (message.attachments.size === 0 && message.content.match(/https?:\/\//) === null) {
					message.delete();
				}
			}
		}
	});
}
