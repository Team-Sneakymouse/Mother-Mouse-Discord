import { Client, ColorResolvable, PrivateThreadChannel, Role, Snowflake, TextChannel, ThreadChannel } from "discord.js";

const MSDVIL_SERVER = "787222656926744586";
const MSDVIL_USER = "684022579450740789";
const MOD_CHANNEL = "787779465409069058";
const PINGS_THREAD = "1487618789678776560";

const WARNING_MESSAGE = `Pinging MsDvil is restricted.
Your message was deleted and a temporary timeout was applied. Please refer to the server rules for the correct way to communicate with staff.`;

export default function PunishPings(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guildId !== MSDVIL_SERVER) return;
		if (message.author.bot || message.author.id == MSDVIL_USER) return;

		const explicitPing = message.mentions.users.has(MSDVIL_USER) && new RegExp(`<@!?${MSDVIL_USER}>`).test(message.content);
		if (!explicitPing) return;

		const modChannel = client.channels.cache.get(MOD_CHANNEL) as TextChannel | undefined;
		const pingThread = modChannel?.threads.cache.get(PINGS_THREAD) as PrivateThreadChannel;
		if (modChannel && pingThread) {
			await message.forward(pingThread);
		}
		await message.delete();
		await message.member?.timeout(15 * 1000, "Pinged MsDvil");
		await message.author.send(WARNING_MESSAGE).catch(() => {
			// ignore if user has DMs closed
			console.warn(`Couldn't send DM to ${message.author.tag}`);
		});
	});
}
