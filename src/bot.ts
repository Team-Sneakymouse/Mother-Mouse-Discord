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
TwitchCommands(client);

// Assing default roles to new members
import NewMemberRoles from "./NewMemberRoles";
NewMemberRoles(client);

// Swap rawb's role color when he sends messages
import RawbColor from "./RawbColor";
RawbColor(client);

// Vibecheck command
import Vibecheck from "./Vibecheck";
Vibecheck(client);

// Rolling dice and evaluating math expressions
import Roll from "./Roll";
Roll(client);

// Self-assignable roles for games
import PalsRoles from "./PalsRoles";
PalsRoles(client, redis);

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("No token found!");
client.login(token);
