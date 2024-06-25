import { Client, Message } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";

type CommandRecord = { server: string; command: string; response: string };

export default function TextCommands(client: Client, pocketbase: PocketBase) {
	client.on("messageCreate", async (message): Promise<any> => {
		if (!message.guild) return;
		if (!message.content.startsWith("!")) return;

		const args = message.content.split(" ");
		const command = args[0].toLowerCase();

		const record = await pocketbase
			.collection("commands")
			.getFirstListItem<RecordModel & CommandRecord>(`discord_server~"${message.guild.id}"&&command="${command}"`)
			.catch((e) => {
				if (e.status !== 404) throw e;
				else return null;
			});
		if (!record) return;

		const response = parseResponse(args, record.response, message);

		message.reply({
			content: response,
			allowedMentions: { repliedUser: false },
		});
	});

	function parseResponse(args: string[], response: string, message: Message) {
		return response
			.replaceAll("${user}", message.author.displayName)
			.replaceAll("${channel}", `<#${message.channel.id}>`)
			.replace(/\${random\.(\d+)-(\d+)}/g, (match, ...captureGroups) => {
				const start = parseInt(captureGroups[0]);
				const end = parseInt(captureGroups[1]);
				return (Math.floor(Math.random() * (end - start + 1)) + start).toString();
			})
			.replace(/\${(\d+)}/g, (match, ...captureGroups) => args[parseInt(captureGroups[0])])
			.replace(/\${(\d+):(\d+)?}/g, (match, ...captureGroups) => {
				const start = Math.min(parseInt(captureGroups[0]), args.length - 1);
				const end = typeof captureGroups[1] === "string" ? parseInt(captureGroups[1]) : args.length - 1;
				return args.slice(start, Math.max(start, end) + 1).join(" ");
			})
			.replace(/\${random\.pick ([^}]+)}/g, (match, ...captureGroups) => {
				const choices = captureGroups[0].split("' '");
				choices[0] = choices[0].replace(/^'/, "");
				choices[choices.length - 1] = choices[choices.length - 1].replace(/'$/, "");
				return choices[Math.floor(Math.random() * choices.length)];
			});
	}
}
