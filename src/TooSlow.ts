import { Client } from "discord.js";

const cooldownMs = 15 * 60 * 1000; // 15 minutes

export default function MediaEmbeds(client: Client) {
	const cooldownExpiresAtByUser = new Map<string, number>();

	client.on("typingStart", async (typing) => {
		if (typing.inGuild()) return;
		if (!typing.channel.isSendable()) return;
		if (isOnCooldown(typing.user.id)) return;

		cooldownExpiresAtByUser.set(typing.user.id, Date.now() + cooldownMs);
		await typing.channel.send(`TOO SLOW! <:1robMyMan:805582449022337024> `);
	});
	client.on("messageCreate", async (message) => {
		if (message.guildId) return;
		cooldownExpiresAtByUser.set(message.author.id, Date.now() + cooldownMs);
	});

	function isOnCooldown(userId: string) {
		const expiresAt = cooldownExpiresAtByUser.get(userId);
		if (!expiresAt) return false;
		if (expiresAt > Date.now()) return true;
		cooldownExpiresAtByUser.delete(userId);
		return false;
	}
}
