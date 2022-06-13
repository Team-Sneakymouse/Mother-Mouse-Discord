import { Client } from "discord.js";
import { Redis } from "ioredis";
import { ScheduleRepeating } from "./utils/unixtime";


const icons = [
	"DANGER",
	"983584227058651146",//homophobia
	"potato",
	"983587660926963712",//trans bee
	"983583925282672670",//jeb
	"983583216592093214",//the wall
	"983583016888729640",//mad axolotl
	"983587651795951646",//kobox
	"976684279981551656",//axolotl bucket
	"968371521645060116",//blushhide
	"976687555850432563",//giant rat
	"burrito",
	"transgender_flag",
	"pirate_flag",
	"982861452949995580",//trans kobold
	"fire",
	"978006052454957117",//bin
	"white_flower",
	"fish_cake",
	"pleading_face",
	"yarn",
	"clown",
	"peach",
	"eggplant",
	"birthday",
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
// const mamisId = "314963721795534848";
const mamisRoleId = "976218563922759690";
const timeout_unix = 60*60*6;


export default function RoleIconRandomization(client: Client, redis: Redis) {
	ScheduleRepeating(redis, "RoleIconRandomization-mami", 0, timeout_unix, async (time) => {
		let guild = await client.guilds.fetch(turtleFriendsId);
		const mamisRole = guild.roles.resolve(mamisRoleId);
		if (!mamisRole) return console.log("Mami's role is missing!");

		if (Math.random() < .5) {
			let icon = guild.emojis.cache.random();
			if (icon) {
				mamisRole.setIcon(icon);
			}
		} else {
			let index = Math.floor(Math.random() * icons.length);
			let chosenIcon = icons[index];
			let icon = guild.emojis.resolve(chosenIcon);
			if (icon) {
				mamisRole.setIcon(icon);
			} else {
				console.log("RoleIconRandomization whitelist has a broken emoji: " + chosenIcon);
			}
		}
	});
}
