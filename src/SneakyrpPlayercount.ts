import type MulticraftAPI from "./utils/multicraft.js";
import { Client } from "discord.js";

export default function SneakyrpPlayercount(client: Client, multicraft: MulticraftAPI) {
	setInterval(async () => {
		const sneakyrpServer = client.guilds.cache.get("725854554939457657");
		if (!sneakyrpServer) return console.error("Could not find sneakyrp server");

		const self = sneakyrpServer.members.cache.get(client.user!.id)!;
		const oldNickname = self.nickname;

		let liveResult;
		try {
			liveResult = await multicraft.call("getServerStatus", { id: 4, player_list: 1 });
		} catch (e) {
			console.error(e);
			if (oldNickname !== null) self.setNickname(null);
			return;
		}
		let newNickname: string;
		if (liveResult.data.status === "offline") newNickname = "Server Offline 🔴";
		else newNickname = `${liveResult.data.players.length} Players Online`;

		if (oldNickname !== newNickname) self.setNickname(newNickname);
	}, 1000 * 60);
}
