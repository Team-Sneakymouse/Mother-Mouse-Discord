import { Client, Intents } from "discord.js";
import Redis from "ioredis";
import { config } from "dotenv";
config();

const redis = new Redis({
	host: process.env.REDIS_HOST || "redis",
});

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MEMBERS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		Intents.FLAGS.GUILD_MESSAGE_TYPING,
	],
});

client.once("ready", () => {
	console.log("Ready!", client.user?.tag);
});

// Simple, canned command responses from Twitch
import TwitchCommands from "./TwitchCommands";

// Assing default roles to new members
import NewMemberRoles from "./NewMemberRoles";

// Swap rawb's role color when he sends messages
import RawbColor from "./RawbColor";

// Vibecheck command
import Vibecheck from "./Vibecheck";

// Rolling dice and evaluating math expressions
import Roll from "./Roll";

// Self-assignable roles for games
import PalsRoles from "./PalsRoles";

// Self-assignable pronoun roles
import PronounRoles from "./PronounRoles";

// TILII todo system
import Todo from "./Todo";

// Manage crossing out milestone messages for money stream
import MoneyMilestone from "./MoneyMilestone";

// Manage trivia answers
import Trivia from "./Trivia";

if (process.env.PRODUCTION == "TRUE") {
	console.log("Registering production plugins");

	TwitchCommands(client);
	NewMemberRoles(client);
	RawbColor(client);
	Vibecheck(client);
	Roll(client);
	PalsRoles(client, redis);
	PronounRoles(client, redis);
	Todo(client);
	MoneyMilestone(client);
} else {
	console.log("Registering development plugins");

	Trivia(client, redis);
}

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("No token found!");
client.login(token);
