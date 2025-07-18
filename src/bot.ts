import Redis from "ioredis";
import express from "express";
import PocketBase from "pocketbase";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { Gitlab } from "@gitbeaker/node";
import RssParser from "rss-parser";
import { config } from "dotenv";
import { createLogger, transports } from "winston";
import LokiTransport from "winston-loki";
config();
import { Tick } from "./utils/unixtime.js";
import MulticraftAPI from "./utils/multicraft.js";
import YouTubeDL from "./utils/youtube-dl.js";

if (!process.env["MULTICRAFT_HOST"] || !process.env["MULTICRAFT_USER"] || !process.env["MULTICRAFT_KEY"])
	throw new Error("Missing Multicraft credentials");
const multicraft = new MulticraftAPI(process.env["MULTICRAFT_HOST"], process.env["MULTICRAFT_USER"], process.env["MULTICRAFT_KEY"]);

const gitlab = new Gitlab({
	token: process.env["GITLAB_TOKEN"],
});

const ytdl = new YouTubeDL();

const rss = new RssParser();

const server = express();
server.use(express.json());

const redis = new Redis({
	host: process.env.REDIS_HOST || "redis",
});

if (!process.env["POCKETBASE_HOST"] || !process.env["POCKETBASE_USERNAME"] || !process.env["POCKETBASE_PASSWORD"])
	throw new Error("Missing PocketBase credentials");
const pocketbase = new PocketBase(process.env["POCKETBASE_HOST"]);
pocketbase.collection("_superusers").authWithPassword(process.env["POCKETBASE_USERNAME"], process.env["POCKETBASE_PASSWORD"]);
pocketbase.autoCancellation(false);

if (!process.env["LOKI_HOST"] || !process.env["LOKI_USER"] || !process.env["LOKI_PASSWORD"]) throw new Error("Missing Loki credentials");
const vcLogger = createLogger({
	defaultMeta: { service_name: "mothermouse", type: "vc-connections" },
	transports: [
		new LokiTransport({
			host: process.env["LOKI_HOST"],
			basicAuth: `${process.env["LOKI_USER"]}:${process.env["LOKI_PASSWORD"]}`,
			batching: false,
			useWinstonMetaAsLabels: true,
			ignoredMeta: ["level", "detected_level"],
			onConnectionError: (err) => console.error(err),
		}),
	],
});

const client = new Client({
	intents: [
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.DirectMessageTyping,
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildPresences,
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

// Assing default roles to new members
import NewMemberRoles from "./NewMemberRoles.js";

// Swap rawb's role color when he sends messages
import RawbColor from "./RawbColor.js";

// Convert video and sound links to embeds
import MediaEmbed from "./MediaEmbeds.js";

// Vibecheck command
import Vibecheck from "./Vibecheck.js";

// Rolling dice and evaluating math expressions
import Roll from "./Roll.js";

// Self-assignable roles for games
import PalsRoles from "./PalsRoles.js";

// Self-assignable pronoun roles
import PronounRoles from "./PronounRoles.js";

// Manage trivia answers
import Trivia from "./Trivia.js";

// Manage permissions for the stage chat channel
import VoiceChannelVisibility from "./VoiceChannelVisibility.js";

// Picture submission for the guess who game
import GuessWho from "./GuessWho.js";

// Too Slow meme in DMs
import TooSlow from "./TooSlow.js";

// Discord stats
import Stats from "./Stats.js";

// Allow users to pin messages
import UserPins from "./UserPins.js";

// Meme responsibly easteregg
import MemeResponsibly from "./MemeResponsibly.js";

// Gitlab issues integration
import GitlabIssues from "./GitlabIssues/index.js";

// Unarchive threads
import UnarchiveThreads from "./UnarchiveThreads.js";

// SneakyRP new application webhook
import SneakyrpApplications from "./SneakyrpApplications.js";

// OOC Discord Dani Power Up
import OocTools from "./OocTools.js";

// SneakyRP playerlist
import SneakyrpPlayerlist from "./SneakyrpPlayerlist.js";

// SneakyRP playercount
import SneakyrpPlayercount from "./SneakyrpPlayercount.js";
import RaidProtection from "./RaidProtection.js";

// start of mami's script imports
// Role Icon Randomization for mami's role
import RoleIconRandomization from "./RoleIconRandomization.js";

// Reply kobold to maris
import MarisKobold from "./MarisKobold.js";

import ClearSupportChannel from "./ClearSupportChannel.js";

import NicknameRandomization from "./NicknameRandomization.js";

import RenameVC from "./RenameVC.js";

import HotlinePosting from "./HotlinePosting.js";

import tfcSolver from "./tfcSolver.js";

// Youtube/soundcloud downloader
import YouTube from "./YouTube.js";

// Delete forbidden reactions
import DeleteHate from "./DeleteHate.js";

// Convert Twitter links to FxTwitter
import TwitterFix from "./TwitterFix.js";

// Manage Discord <-> Minecraft linking for whitelist
import DvzRegistrations from "./MinecraftDvzRegistrations.js";

// Manage pocketbase listeners for the LoM2 Job Board
import Lom2JobBoard from "./Lom2JobBoard.js";

// Faq
import Faq from "./Faq.js";

// Minecraft UUID lookup
import Uuid from "./Uuid.js";

// Channel filters
import ChannelFilters from "./ChannelFilters.js";

// Starboard
import Starboard from "./Starboard.js";

// Minecraft whitelist
import MinecraftWhitelist from "./MinecraftWhitelist.js";

// Linked Role
import LinkedRole from "./LinkedRole.js";

// Text Commands
import TextCommands from "./TextCommands.js";

// RSS
import PostAnnouncements from "./PostAnnouncuements.js";

// Delete/Edit Log
import DeleteLog from "./DeleteLog.js";

// ModChat
import ModChat from "./ModChat.js";

// EditBotMessages
import EditBotMessages from "./EditBotMessages.js";

// FillCache
import FillCache from "./FillCache.js";

// Blockbench downloader
import BlockbenchDownloader from "./BlockbenchDownloader.js";

// VC Monitor
import VCMonitor from "./VCMonitor.js";

// TimeToLive
import TimeToLive from "./TimeToLive.js";

// Clear Channel Voting
import ChannelClearVoting from "./ChannelClearVoting.js";

// Account Management
import AccountManagement from "./AccountManagement/index.js";

if (process.env.PRODUCTION == "TRUE") {
	client.setMaxListeners(31);
	console.log("Registering production plugins");

	NewMemberRoles(client);
	RawbColor(client);
	Vibecheck(client);
	Roll(client);
	PalsRoles(client, redis);
	PronounRoles(client, redis);
	Trivia(client, redis);
	MediaEmbed(client);
	VoiceChannelVisibility(client);
	GuessWho(client, redis);
	TooSlow(client, redis);
	Stats(client, redis);
	UserPins(client, pocketbase);
	MemeResponsibly(client);
	GitlabIssues(client, redis, server, gitlab);
	UnarchiveThreads(client, pocketbase, gitlab);
	SneakyrpApplications(client, redis, server);
	OocTools(client);
	// SneakyrpPlayerlist(client, multicraft);
	// SneakyrpPlayercount(client, multicraft);
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
	DvzRegistrations(client, pocketbase, multicraft);
	Lom2JobBoard(client, pocketbase);
	Faq(client, pocketbase);
	Uuid(client);
	ChannelFilters(client);
	Starboard(client);
	MinecraftWhitelist(client, multicraft);
	LinkedRole(client, server, pocketbase);
	TextCommands(client, pocketbase);
	// PostAnnouncements(client, server, pocketbase);
	DeleteLog(client);
	ModChat(client);
	EditBotMessages(client);
	FillCache(client);
	BlockbenchDownloader(client);
	VCMonitor(client, vcLogger);
	TimeToLive(client);
	ChannelClearVoting(client, pocketbase);
	AccountManagement(client, pocketbase, server);
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
