import type MulticraftAPI from "./utils/multicraft";
import { Client } from "discord.js";

export default function SneakyrpPlayercount(client: Client, multicraft: MulticraftAPI) {
	setInterval(async () => {
		const sneakyrpServer = client.guilds.cache.get("725854554939457657");
		if (!sneakyrpServer) return console.error("Could not find sneakyrp server");

		const self = sneakyrpServer.members.cache.get(client.user!.id)!;

		let liveResult;
		try {
			liveResult = await multicraft.call("getServerStatus", { id: 4, player_list: 1 });
		} catch (e) {
			console.error(e);
			self.setNickname(null);
			return;
		}

		if (liveResult.data.status === "offline") self.setNickname("Server Offline 🔴");
		else self.setNickname(`${liveResult.data.players.length} Players online`);
	}, 1000 * 60 * 5);
}
