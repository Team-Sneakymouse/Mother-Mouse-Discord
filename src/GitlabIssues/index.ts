import type { Client } from "discord.js";
import type { Redis } from "ioredis";
import type { Express } from "express";
import type { Gitlab } from "@gitbeaker/node";
import initWebhook from "./webhooks.js";
import initCommands from "./commands.js";
import initModals from "./modals.js";
import initButtons from "./buttons.js";
import initMessages from "./messages.js";

export { data } from "./commands.js";
export default function GitlabIssues(client: Client, redis: Redis, server: Express, gitlab: InstanceType<typeof Gitlab>) {
	const commands = initCommands(client, gitlab);
	const modals = initModals(client, redis, gitlab);
	const buttons = initButtons(client, gitlab);
	const messages = initMessages(client, gitlab);

	client.on("interactionCreate", (interaction) => {
		if (commands.matcher(interaction)) commands.handler(interaction);
		else if (modals.matcher(interaction)) modals.handler(interaction);
		else if (buttons.matcher(interaction)) buttons.handler(interaction);
	});
	client.on("messageCreate", (m) => {
		if (messages.matcher(m)) messages.handler(m);
	});

	const webhookHandler = initWebhook(client, redis, gitlab);
	server.post("/gitlab", webhookHandler);

	return gitlab;
}
