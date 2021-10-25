import { Client, Intents } from "discord.js";
import { config } from "dotenv";
config();

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		//Intents.FLAGS.GUILD_MEMBERS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		Intents.FLAGS.GUILD_MESSAGE_TYPING,
	],
});

client.once("ready", () => {
	console.log("Ready!");
});

// Simple, canned command responses from Twitch
import TwitchCommands from "./TwitchCommands";
TwitchCommands(client);

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("No token found!");
client.login(token);
