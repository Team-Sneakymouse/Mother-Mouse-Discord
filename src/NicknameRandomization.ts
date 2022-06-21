import { Client } from "discord.js";
import { Redis } from "ioredis";
import { ScheduleRepeating, SECS_IN_DAY } from "./utils/unixtime";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;


const names = [
	"Mother Mouse",
	"DANGER",
	"Mother Kobold",
	"Morbin Mouse",
	"Jeb Bush",
	"Doug Walker", 
	"Doug Bowser",
	"Changing my nickname makes me sad :(",
	"It's ok to leave me in a hot car",
	"Burrito",
	"All my apes gone",
	"21 Pilots",
	"Oatmeal Dispenser",
	"Mommy Mouse",
	"Lonely Mouse",
	"Crungus",
	"Daddy Mouse",
	"Stuart Little",
	"Remmi Rattitoui",
	"Federal Agent",
	"The Lightbringer",
	"A dead rat in a trenchcoat",
];


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const mmId = "713723936231129089";

export default function NicknameRandomization(client: Client, redis: Redis) {
	ScheduleRepeating(redis, {

		eventId: "NicknameRandomization-mm",
		eventEpoch: 1655424000,
		secsBetweenEvents: SECS_IN_DAY,

		executor: async (time) => {
			let guild = await client.guilds.fetch(turtleFriendsId);
			let mm = guild.members.resolve(mmId);
			if (!mm) return console.log("Mother Mouse is missing from the turtle server?");

			let index = Math.floor(Math.random() * names.length);
			let chosenName = names[index];
			mm.setNickname(chosenName);
		}
	});
}

