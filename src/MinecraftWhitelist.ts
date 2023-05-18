import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import MulticraftAPI from "./utils/multicraft.js";
export const data = [
	new SlashCommandBuilder()
		.setName("whitelist")
		.setDescription("Add your Minecraft account to the whitelist")
		.addStringOption(new SlashCommandStringOption().setName("username").setDescription("Minecraft username").setRequired(true)),
] as const;

const DISCORD_TO_MINECRAFT_SERVER = {
	"787222656926744586": 7, // MsDvil
};

export default function MinecraftWhitelist(client: Client, multicraft: MulticraftAPI) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.guildId || !Object.keys(DISCORD_TO_MINECRAFT_SERVER).includes(interaction.guildId)) return;
		if (interaction.isChatInputCommand() && interaction.commandName === "whitelist") {
			if (!interaction.member) {
				await interaction.reply("🛑 You must be in a server to register.");
				return;
			}

			const username = interaction.options.getString("username", true);
			const profile = await usernameToProfile(username);
			if (!profile) {
				await interaction.reply(`🛑 Minecraft username ${username} does not exist.`);
				return;
			}

			const commandResponse = await multicraft.call("sendConsoleCommand", {
				server_id: DISCORD_TO_MINECRAFT_SERVER[interaction.guildId as keyof typeof DISCORD_TO_MINECRAFT_SERVER],
				command: `whitelist add ${profile.name}`,
			});
			if (!commandResponse.success) {
				await interaction.reply(`🛑 An error occurred while adding ${profile.name} to the whitelist.`);
				console.error("Multicraft error", JSON.stringify(commandResponse.errors, null, 2));
				return;
			}

			await interaction.reply({
				content: "",
				embeds: [
					{
						title: "Success",
						description: `${profile.name} is whitelisted`,
						color: 0x4db924,
						thumbnail: {
							url: `https://crafatar.com/renders/body/${profile.id}?overlay`,
						},
					},
				],
			});
		}
	});
}

async function usernameToProfile(username: string) {
	let res: Response;
	try {
		res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);
	} catch (e) {
		console.error("Fetch error", e);
		throw new Error("Fetch error");
	}
	while (res.status === 429) {
		console.log("Mojang API rate limit, retrying in 1s");
		await new Promise((resolve) => setTimeout(resolve, 1000));
		res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);
	}
	if (res.status === 204 || res.status === 400 || res.status === 404) return null;
	if (res.status !== 200) {
		console.error("Mojang API error", res.status, res.statusText, await res.text());
		throw new Error("Mojang API error");
	}
	return (await res.json()) as { name: string; id: string };
}
