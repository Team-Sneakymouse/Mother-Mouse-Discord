import { Client } from "discord.js";
import { Redis } from "ioredis";
import { ScheduleRepeating, SECS_IN_DAY } from "./utils/unixtime.js";

const primaryName = "Mother Mouse";
const names = [
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
	"Ricky Rat",
];

const turtleFriendsId = "898925497508048896";// turtle friends discord id
const mmId = "713723936231129089";

export default function NicknameRandomization(client: Client, redis: Redis) {
	ScheduleRepeating(
		redis,
		"NicknameRandomization-mm",//eventId
		1655424000,//eventEpoch
		SECS_IN_DAY,//secsBetweenEvents
		async (time) => {//executor
			let guild = await client.guilds.fetch(turtleFriendsId);
			let mm = guild.members.resolve(mmId);
			if (!mm) return console.log("NicknameRandomization: Mother Mouse is missing from the turtle server?");

			let chosenName = primaryName;
			if(Math.random() < 1.0/6.0) {
				let index = Math.floor(Math.random() * names.length);
				chosenName = names[index];
			}
			mm.setNickname(chosenName);
		}
	);
}

