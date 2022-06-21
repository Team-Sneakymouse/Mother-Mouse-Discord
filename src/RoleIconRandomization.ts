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
	"988890878640795679",//potato
	"988890921162641509",//burrito
	"988891226990342205",//trans flag
	"988891270808223765",//pirate flag
	"988891319034323004",//white flower
	"988891359345795092",//fish cake
	"988890666786488350", //yarn
	"988891396574416966",//clown
	"988891431420702780",//birthday
	"988891462815076482",//heart
	"988891158606409738",//pleading
	"988891013626077235",//peach
	"988891089920458833",//melon
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
// const mamisId = "314963721795534848";
const mamisRoleId = "976218563922759690";
const timeout_unix = 60*60*6;


export default function RoleIconRandomization(client: Client, redis: Redis) {
	ScheduleRepeating(redis, {
		eventId: "RoleIconRandomization-mami",
		eventEpoch: 0,
		secsBetweenEvents: timeout_unix,
		executor: async(time) => {
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
		}
	});
}
