import type { Client } from "discord.js";

const WELCOME_CHANNEL_ID = "1481862975047602236";
const RATS_ROLE_ID = "631608275883917332";

export default function RatsRoleAssignment(client: Client) {
	client.on("messageCreate", async (message) => {
		if (message.author.bot) return;
		if (message.channelId !== WELCOME_CHANNEL_ID) return;
		if (!message.member) return console.error(`Message member is null for message ${message.id} in channel ${message.channelId}`);
		console.log(`Assigning rats role to new member ${message.author.tag} (${message.author.id})`);

		await message.member.roles.add(RATS_ROLE_ID);
	});
}
