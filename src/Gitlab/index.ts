import type { Client } from "discord.js";
import type { Redis } from "ioredis";
import type { Express } from "express";
import { Gitlab as GitlabApi } from "@gitbeaker/node";
import initWebhook from "./webhooks";
import initCommands from "./commands";
import initModals from "./modals";
import initButtons from "./buttons";
import initMessages from "./messages";
import initThreads from "./threads";

export { data } from "./commands";
export default function Gitlab(client: Client, redis: Redis, server: Express) {
	const gitlab = new GitlabApi({
		token: process.env["GITLAB_TOKEN"],
	});

	const commands = initCommands(client, gitlab);
	const modals = initModals(client, redis, gitlab);
	const buttons = initButtons(client, gitlab);
	const messages = initMessages(client, gitlab);
	const threads = initThreads(client, gitlab);

	client.on("interactionCreate", (interaction) => {
		if (commands.matcher(interaction)) return commands.handler(interaction);
		if (modals.matcher(interaction)) return modals.handler(interaction);
		if (buttons.matcher(interaction)) return buttons.handler(interaction);
	});
	client.on("messageCreate", (m) => {
		if (messages.matcher(m)) return messages.handler(m);
	});
	client.on("threadUpdate", (_, t) => {
		if (threads.matcher(t)) return threads.handler(t);
	});

	const webhookHandler = initWebhook(client, redis, gitlab);
	server.post("/gitlab", webhookHandler);
}
