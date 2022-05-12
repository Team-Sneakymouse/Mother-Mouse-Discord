import { Client } from "discord.js";

var changeBackTimeout: NodeJS.Timeout;

export default function RawbColor(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guild.id !== "391355330241757205") return;
		if (message.author.id !== "90956966947467264") return;

		const digitalBardRole = message.guild.roles.resolve("413105777885052969");
		if (!digitalBardRole) return console.log("Digital Bard role is missing!");

		await digitalBardRole.setColor(digitalBardRole.color == 1029605 ? "#FF26A4" : "#0FB5E5");

		if (changeBackTimeout) clearTimeout(changeBackTimeout);
		changeBackTimeout = setTimeout(() => digitalBardRole.setColor("#0FB5E5"), 5000);
	});
}
