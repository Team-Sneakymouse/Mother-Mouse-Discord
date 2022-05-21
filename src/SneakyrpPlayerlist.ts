import MulticraftAPI from "./utils/multicraft";
import { Client } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
export const data = [new SlashCommandBuilder().setName("playerlist").setDescription("Displays a list of players on SneakyRP")];

export default function SneakyrpPlayerlist(client: Client) {
	const multicraft = new MulticraftAPI("https://admin.sneakyrp.com/api.php", "admin", "sDPm*XzermUKqf");

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "playerlist") {
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
