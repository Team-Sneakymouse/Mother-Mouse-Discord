import { Client } from "discord.js";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;


const names = [
	"Mother Mouse",
	"Changing my name makes me sad :(",
	"Mother Morbin",
	"Mother Jeb",
	"Mother Moose",
	"Oatmeal Robot",
	"It's ok to leave me in a hot car",
	"All Alone",
	"Never gonna give you up",
	"Mother Turtle",
	"Morbin Mouse",
	"Deadmau5",
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const timeout_ms = 1000*60*60*4;


export default function RoleIconRandomization(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guildId === turtleFriendsId && message.author.id === mamisId) {
			if (!isTimedOut) {
				isTimedOut = true;
				changeTimeout = setTimeout(() => { isTimedOut = false; }, timeout_ms);

				const mamisRole = message.guild.roles.resolve(mamisRoleId);
				if (!mamisRole) return console.log("Mami's role is missing!");

				if (Math.random() < .5) {
					let icon = message.guild.emojis.cache.random();
					if (icon) {
						await mamisRole.setIcon(icon);
					}
				} else {
					let index = Math.floor(Math.random()*icons.length);
					let chosenIcon = icons[index];
					let icon = message.guild.emojis.resolve(chosenIcon);
					if (icon) {
						await mamisRole.setIcon(icon);
					} else {
						console.log("RoleIconRandomization whitelist has broken emoji: " + chosenIcon);
					}
				}
			}
		}
	});
}
