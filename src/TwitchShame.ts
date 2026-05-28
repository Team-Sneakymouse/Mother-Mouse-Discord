import { AttachmentBuilder, type Client } from "discord.js";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

import { formatZodError, twitchShamePayloadSchema, type TwitchShamePayload } from "./utils/validation/TwitchShamePayload.js";
import { renderTwitchShamePng } from "./utils/TwitchShameRenderer.js";

const twitchShameGuildId = "787222656926744586";
const twitchShameChannelId = "1454471948720410906";
const requestLimit = "64kb";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextFrom(body: unknown) {
	if (!isRecord(body)) return "id=unknown channel=unknown sender=unknown";
	const user = isRecord(body.user) ? body.user : {};
	return `id=${String(body.id ?? "unknown")} channel=${String(body.channel ?? "unknown")} sender=${String(user.login ?? user.displayName ?? "unknown")}`;
}

export default function TwitchShame(client: Client, server: Express) {
	const readyPromise = client.isReady() ? Promise.resolve() : new Promise<void>((resolve) => client.once("clientReady", () => resolve()));

	server.post("/twitchshame", express.json({ limit: requestLimit }), async (req: Request, res: Response) => {
		const expectedPassword = process.env["TWITCH_SYNC_PASSWORD"];
		if (!expectedPassword || req.query.password !== expectedPassword) {
			console.error(`TwitchShame authentication failed: ${contextFrom(req.body)}`);
			res.status(401).send("Unauthorized");
			return;
		}

		const validation = twitchShamePayloadSchema.safeParse(req.body);
		if (!validation.success) {
			const message = formatZodError(validation.error);
			console.error(`TwitchShame validation failed: ${message}; ${contextFrom(req.body)}`);
			res.status(400).send(message);
			return;
		}

		const payload: TwitchShamePayload = validation.data;
		let image: Buffer;
		try {
			image = await renderTwitchShamePng(payload);
		} catch (error) {
			console.error(`TwitchShame rendering failed: ${contextFrom(payload)}`, error);
			res.status(500).send("Internal server error");
			return;
		}

		try {
			await readyPromise;
			const guild = client.guilds.cache.get(twitchShameGuildId) ?? (await client.guilds.fetch(twitchShameGuildId));
			const channel = guild.channels.cache.get(twitchShameChannelId) ?? (await guild.channels.fetch(twitchShameChannelId));

			if (!channel || channel.isDMBased() || !channel.isTextBased() || !("send" in channel)) {
				throw new Error(`Channel ${twitchShameChannelId} is not sendable`);
			}

			await channel.send({
				// content: "```json\n" + JSON.stringify(payload, null, 2) + "\n```",
				files: [
					new AttachmentBuilder(image, {
						name: `twitch-shame-${payload.id}.png`,
					}),
				],
			});

			res.status(200).send("ok");
		} catch (error) {
			console.error(`TwitchShame discord-posting failed: ${contextFrom(payload)}`, error);
			res.status(500).send("Internal server error");
		}
	});

	server.use("/twitchshame", (error: unknown, req: Request, res: Response, next: NextFunction) => {
		if (!error) {
			next();
			return;
		}

		const status = isRecord(error) && typeof error.status === "number" ? error.status : 400;
		console.error(`TwitchShame validation failed: malformed or oversized JSON; ${contextFrom(req.body)}`, error);
		res.status(status === 413 ? 413 : 400).send(status === 413 ? "Payload too large" : "Malformed JSON");
	});
}
