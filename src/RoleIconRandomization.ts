import { Client } from "discord.js";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;


const icons = [
	"DANGER",
	"983584227058651146",//homophobia
	"potato",
	"983587660926963712",//trans bee
	"983583064137539634",//pograt
	"983583925282672670",//jeb
	"983583216592093214",//the wall
	"983583016888729640",//mad axolotl
	"983587651795951646",//kobox
	"976684279981551656",//axolotl bucket
	"968371521645060116",//blushhide
	"983583133679099927",//knuck
	"976687555850432563",//giant rat
	"943214495457771581",//sad party
	"burrito",
	"transgender_flag",
	"pirate_flag",
	"982861452949995580",//trans kobold
	"fire",
	"978006052454957117",//bin
	"white_flower",
	"fish_cake",
	"pleading_face",
	"978230173851873290",//turtle bonk
	"yarn",
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const mamisId = "314963721795534848";// turtle friends discord id
const mamisRoleId = "976218563922759690";
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
