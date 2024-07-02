import { Client } from "discord.js";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;

const turtleFriendsId = "898925497508048896"; // turtle friends discord id
const marisId = "357167385016532992";
const timeout_ms = 1000 * 60 * 60 * 24;
const probKobold = 5 / 100;
const reply = "kobold!";

export default function MarisKobold(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guildId === turtleFriendsId && message.author.id === marisId && message.content.includes("kobold")) {
			if (!isTimedOut) {
				isTimedOut = true;
				changeTimeout = setTimeout(() => {
					isTimedOut = false;
				}, timeout_ms);

				if (Math.random() < probKobold) {
					message.reply(reply);
				}
			}
		}
	});
}
