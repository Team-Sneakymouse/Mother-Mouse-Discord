import { Client, TextChannel } from "discord.js";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const messageHotline = "Dial **988** or **1-800-273-8255** for the National Suicide Prevention Lifeline <:bless:975520085919809587>";
const triggerWords = [
	"siucide",
	"sucide",
	"suicide",
	"killmyself",
	"kms",
	"endingit",
	"endmyself",
];
const triggerChannels = [
	"975496209882050640",
	"980550809005736066",
	"980550256116785252",
];
const timeout_ms = 1000*60*60*24;


export default function HotlinePosting(client: Client) {
	client.on("messageCreate", async (message) => {
		if (!message.guild) return;
		if (message.guildId === turtleFriendsId && triggerChannels.includes(message.channelId)) {
			console.log("ffgix");
			let content = message.content.toLowerCase().replace(/\s/gm, '');
			let doPost = false;
			for (let word of triggerWords) {
				if (content.includes(word)) {
					doPost = true;
					break;
				}
			}
			console.log("dsfs");
			if (doPost && !isTimedOut) {
				isTimedOut = true;
				changeTimeout = setTimeout(() => { isTimedOut = false; }, timeout_ms);

				console.log("Hotline Posting: someone triggered this script, posting now");
				(message.channel as TextChannel).send(messageHotline);
			}
		}
	});
}
