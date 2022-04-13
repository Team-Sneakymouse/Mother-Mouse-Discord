import { Client, Colors, EmbedBuilder, GuildMember, TextChannel } from "discord.js";
import { Redis } from "ioredis";
import type { Express, Request, Response } from "express";

type ApplicationData = {
	id: string;
	form: "roleplay" | "buildteam";
	responses: {
		id: number;
		title: string;
		response: string | string[];
	}[];
};

export default function SneakyrpApplications(client: Client, redis: Redis, server: Express) {
	server.post("/sneakyrpapplications", async (req: Request, res: Response) => {
		const sneakyrpServer = client.guilds.cache.get("725854554939457657")!;
		const appChannel = client.channels.cache.get("963808503808557127") as TextChannel;

		const { id, form, responses } = req.body as ApplicationData;
		console.log(
			`New SneakyRP application by ${responses.find((r) => r.title.includes("Discord"))?.response} for ${form} (${id})`
		);

		const previousMessageId = await redis.get(`mm-discord-sneakyrp:application-${id}`);

		const discordTagResponse = responses.find((r) => r.title.includes("Discord tag"));
		let member: GuildMember | undefined;
		if (discordTagResponse) {
			const discordTag = discordTagResponse.response as string;
			member = (await sneakyrpServer.members.search({ query: discordTag, limit: 1 })).first();
		} else {
			console.error("No Discord tag found in application response");
		}

		const embed = EmbedBuilder.from({
			title: previousMessageId ? "Updated Application" : "New Application",
			color: previousMessageId ? Colors.Orange : Colors.Green,
			author: {
				name: `${member?.displayName ?? "Unknown"} (${member?.user.tag ?? "Unknown"})`,
				icon_url:
					member?.user.avatarURL() ?? "https://polybit-apps.s3.amazonaws.com/stdlib/users/discord/profile/image.png",
			},
			fields: responses
				.filter((r) => r.id !== discordTagResponse?.id)
				.map((r) => ({
					name: r.title,
					value: Array.isArray(r.response) ? "• " + r.response.join("\n • ") : r.response,
				})),
		}).data;

		const message = await appChannel.send({
			content: "\u00A0",
			embeds: [embed],
			reply: previousMessageId
				? {
						messageReference: previousMessageId,
						failIfNotExists: false,
				  }
				: undefined,
		});
		await redis.set(`mm-discord-sneakyrp:application-${id}`, message.id);

		if (previousMessageId) {
			const previousMessage = await appChannel.messages.fetch(previousMessageId);
			if (previousMessage.embeds[0]) {
				const previousEmbed = EmbedBuilder.from({
					...previousMessage.embeds[0].toJSON(),
					title: "Outdated Application",
					url: message.url,
					color: Colors.Grey,
				}).data;
				await previousMessage.edit({
					embeds: [previousEmbed],
				});
			}
		}
	});
}
