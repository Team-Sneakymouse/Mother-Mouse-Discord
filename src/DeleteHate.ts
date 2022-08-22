import { Client } from "discord.js";

const bannedEmojiPatterns = [
	/middle[_-\s]?finger/i,
	/fuck[_-\s]?you/i
];

const checkedUsers = [
	"416465357050609665"
]

export default function RawbColor(client: Client) {
	client.on("messageReactionAdd", async (reaction, user) => {
		if (!checkedUsers.includes(user.id)) return;

		if (bannedEmojiPatterns.some((pattern) => pattern.test(reaction.emoji.identifier))) {
			console.log(`Deleting reaction ${reaction.emoji.identifier} from ${user.tag}`);
			setTimeout(() => reaction.users.remove(), 1000 * 60);
		}
	});
}
