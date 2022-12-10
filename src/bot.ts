import Redis from "ioredis";
import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import { config } from "dotenv";
config();
import { Tick } from "./utils/unixtime";
import MulticraftAPI from "./utils/multicraft";
import YouTubeDL from "./utils/youtube-dl";

if (!process.env["MULTICRAFT_HOST"] || !process.env["MULTICRAFT_USER"] || !process.env["MULTICRAFT_KEY"])
	throw new Error("Missing Multicraft credentials");
const multicraft = new MulticraftAPI(
	process.env["MULTICRAFT_HOST"],
	process.env["MULTICRAFT_USER"],
	process.env["MULTICRAFT_KEY"]
);

const gitlab = new Gitlab({
	token: process.env["GITLAB_TOKEN"],
});

const ytdl = new YouTubeDL();

const server = express();
server.use(express.json());

const redis = new Redis({
	host: process.env.REDIS_HOST || "redis",
});

const client = new Client({
	intents: [
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.DirectMessageTyping,
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.GuildMessageTyping,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.MessageContent,
	],
	partials: [Partials.Channel, Partials.Message, Partials.Reaction],
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

// Convert video and sound links to embeds
import MediaEmbed from "./MediaEmbeds";

// Vibecheck command
import Vibecheck from "./Vibecheck";

// Rolling dice and evaluating math expressions
import Roll from "./Roll";

// Self-assignable roles for games
import PalsRoles from "./PalsRoles";

// Self-assignable pronoun roles
import PronounRoles from "./PronounRoles";

// Manage crossing out milestone messages for money stream
// import MoneyMilestone from "./MoneyMilestone";

// Manage trivia answers
import Trivia from "./Trivia";

// Manage permissions for the stage chat channel
import StageChatChannel from "./StageChatChannel";

// Picture submission for the guess who game
import GuessWho from "./GuessWho";

// Execute Redis commands
import RedisRelay from "./RedisRelay";

// Too Slow meme in DMs
import TooSlow from "./TooSlow";

// Discord stats
import Stats from "./Stats";

// Allow users to pin messages
import UserPins from "./UserPins";

// Meme responsibly easteregg
import MemeResponsibly from "./MemeResponsibly";

// Gitlab issues integration
import GitlabIssues from "./GitlabIssues";

// Unarchive threads
import UnarchiveThreads from "./UnarchiveThreads";

// SneakyRP new application webhook
import SneakyrpApplications from "./SneakyrpApplications";

// OOC Discord Dani Power Up
import OocTools from "./OocTools";

// SneakyRP playerlist
import SneakyrpPlayerlist from "./SneakyrpPlayerlist";

// SneakyRP playercount
import SneakyrpPlayercount from "./SneakyrpPlayercount";
import RaidProtection from "./RaidProtection";

// start of mami's script imports
// Role Icon Randomization for mami's role
import RoleIconRandomization from "./RoleIconRandomization";

// Reply kobold to maris
import MarisKobold from "./MarisKobold";

import ClearSupportChannel from "./ClearSupportChannel";

import NicknameRandomization from "./NicknameRandomization";

import RenameVC from "./RenameVC";

import HotlinePosting from "./HotlinePosting";

import tfcSolver from "./tfcSolver";

// Youtube/soundcloud downloader
import YouTube from "./YouTube";

// Delete forbidden reactions
import DeleteHate from "./DeleteHate";

import TwitterFix from "./TwitterFix";

if (process.env.PRODUCTION == "TRUE") {
	client.setMaxListeners(31);
	console.log("Registering production plugins");

	TwitchCommands(client);
	NewMemberRoles(client);
	RawbColor(client);
	Vibecheck(client);
	Roll(client);
	PalsRoles(client, redis);
	PronounRoles(client, redis);
	// MoneyMilestone(client);
	Trivia(client, redis);
	MediaEmbed(client);
	StageChatChannel(client);
	GuessWho(client, redis);
	RedisRelay(client, redis);
	TooSlow(client, redis);
	Stats(client, redis);
	UserPins(client);
	MemeResponsibly(client);
	GitlabIssues(client, redis, server, gitlab);
	UnarchiveThreads(client, gitlab);
	SneakyrpApplications(client, redis, server);
	OocTools(client);
	SneakyrpPlayerlist(client, multicraft);
	SneakyrpPlayercount(client, multicraft);
	RaidProtection(client, redis);
	YouTube(client, ytdl);
	RoleIconRandomization(client, redis);
	NicknameRandomization(client, redis);
	MarisKobold(client);
	ClearSupportChannel(client, redis);
	HotlinePosting(client);
	RenameVC(client);
	DeleteHate(client);
	tfcSolver(client);
	TwitterFix(client);
} else {
	console.log("Registering development plugins");
}

server.get("/", (req, res) => res.send("ok"));
server.listen(process.env.HTTP_PORT || 80, () => console.log("Listening on port " + process.env.HTTP_PORT));

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("No token found!");
client.login(token);

client.once("ready", async () => {
	//manage events queued off of unix time
	while (true) {
		let t = Tick(redis);
		await new Promise((resolve) => setTimeout(resolve, t * 1000));
	}
});
