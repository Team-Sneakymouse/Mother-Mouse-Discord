import { Client } from "discord.js";
import PocketBase, { Record as PBRecord } from "pocketbase";

type CommandRecord = { server: string; command: string; response: string };

export default function TextCommands(client: Client, pocketbase: PocketBase) {
	client.on("messageCreate", async (message): Promise<any> => {
		if (!message.guild) return;
		if (!message.content.startsWith("!")) return;

		const args = message.content.split(" ");
		const command = args.shift()!.toLowerCase();

		const record = await pocketbase
			.collection("commands")
			.getFirstListItem<PBRecord & CommandRecord>(`discord_server~"${message.guild.id}"&&command="${command}"`)
			.catch((e) => {
				if (e.status !== 404) throw e;
				else return null;
			});
		if (!record) return;

		message.reply({
			content: record?.response,
			allowedMentions: { repliedUser: false },
		});
	});
}
