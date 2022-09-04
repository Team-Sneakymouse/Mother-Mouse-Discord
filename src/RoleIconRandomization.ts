import { Client } from "discord.js";
import { Redis } from "ioredis";
import { ScheduleRepeating } from "./utils/unixtime";


const icons = [
	"983584227058651146",//homophobia
	"983587660926963712",//trans bee
	"983583925282672670",//jeb
	"983583216592093214",//the wall
	"983583016888729640",//mad axolotl
	"983587651795951646",//kobox
	"976684279981551656",//axolotl bucket
	"968371521645060116",//blushhide
	"976687555850432563",//giant rat
	"978006052454957117",//bin
	"982861452949995580",//trans kobold
	"🥔",//potato
	"🌯",//burrito
	"988891226990342205",//trans flag
	"🏴‍☠️",//pirate flag
	"🌼",//white flower
	"988891359345795092",//fish cake
	"🧶",//yarn
	"🤡",//clown
	"🎂",//birthday
	"♥",//heart
	"🥺",//pleading
	"🍑",//peach
	"🍉",//melon
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const mamisRoleId = "976218563922759690";
const timeout_unix = 60*60*6;


export default function RoleIconRandomization(client: Client, redis: Redis) {
	ScheduleRepeating(
		redis,
		"RoleIconRandomization-mami",//eventId
		0,//eventEpoch
		timeout_unix,//secsBetweenEvents
		async (time) => {//executor
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
				// let icon = client.emojis.resolve(chosenIcon);
				try {
					mamisRole.setIcon(chosenIcon);
				} catch {
					console.log("RoleIconRandomization whitelist has a broken emoji: " + chosenIcon);
				}
			}
		}
	);
}
