import type { Client } from "discord.js";

const WELCOME_CHANNEL_ID = "1481862975047602236";
const ROLE_ID = "631608275883917332";

export default function RatsRoleAssignment(client: Client) {
	client.on("messageCreate", async (message) => {
		if (message.channelId !== WELCOME_CHANNEL_ID || !message.member || message.author.bot) return;

		await message.member.roles.add(ROLE_ID);
	});
}
