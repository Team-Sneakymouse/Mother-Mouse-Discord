import type MulticraftAPI from "./utils/multicraft.js";
import { Client, SlashCommandBuilder } from "discord.js";
import axios from "axios";
export const data = [new SlashCommandBuilder().setName("playerlist").setDescription("Displays a list of players on SneakyRP")];

export default function SneakyrpPlayerlist(client: Client, multicraft: MulticraftAPI) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "playerlist") {
			if (interaction.guildId === "898925497508048896") {
				const res = await axios("https://mcapi.us/server/status?ip=public.sneakyrp.com&port=25560");
				if (!res.data) {
					interaction.reply("Couldn't get playerlist");
					return;
				}
				interaction.reply(`There are currently ${(res.data as any).players.now} players online.`);
				return;
			}

			const [lobbyResult, liveResult] = (
				await Promise.all([
					multicraft.call("getServerStatus", { id: 3, player_list: 1 }),
					multicraft.call("getServerStatus", { id: 4, player_list: 1 }),
				])
			).map((r) => r.data);

			const lobbyStatus = lobbyResult.status === "online" ? "🟢" : "🔴";
			const liveStatus = liveResult.status === "online" ? "🟢" : "🔴";
			const lobbyList = lobbyResult.players.map((p) => `• ${p.name}`).join("\n");
			const liveList = liveResult.players.map((p) => `• ${p.name}`).join("\n");

			interaction.reply({
				content: `${lobbyStatus} **Lobby** (${lobbyResult.players.length}):\n${lobbyList}\n\n${liveStatus} **RP Server** (${liveResult.players.length}):\n${liveList}`,
				ephemeral: true,
			});
			return;
		}
	});
}
