import {
	Client,
	Colors,
	EmbedBuilder,
	GuildMember,
	Message,
	MessageAttachment,
	TextChannel,
	ComponentType,
	ButtonStyle,
} from "discord.js";
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
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isButton()) return;
		if (interaction.customId !== "sneakyrp-applications:accept") return;

		const sneakyrpServer = client.guilds.cache.get("725854554939457657")!;
		const userId = interaction.message.embeds[0]?.footer?.text.split(" | ")[0];
		if (!userId) return interaction.reply(`Could not find user with id ${userId}`);
		const member = await sneakyrpServer.members.fetch(userId);

		await member.roles.add("731268929489600634");

		const roleplayChannel = client.channels.cache.get("958760167061717062") as TextChannel;
		roleplayChannel.send({
			content: `Welcome, <@${userId}>! <:storytime:733433864227258368>\nPlease check the pins in this channel for info on how to get set up on the server.`,
		});

		await (interaction.message as Message).edit({
			components: [],
		});
		interaction.reply(
			`${(interaction.member as GuildMember).displayName} accepted the application of **${member.displayName}**`
		);
	});

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
			const [discordName, discordDiscriminator] = discordTag.split("#");

			const results = await sneakyrpServer.members.search({ query: discordName, limit: 10 });
			if (results.size === 0) {
				console.error(`No guild member found for ${discordName}`);
			} else {
				member = results.find(
					(m) =>
						m.user.username.toLowerCase() === discordName.toLowerCase() &&
						m.user.discriminator === discordDiscriminator
				);
			}
		} else {
			console.error("No Discord tag found in application response");
		}

		const embed = EmbedBuilder.from({
			title: previousMessageId ? "Updated Application" : "New Application",
			color: previousMessageId ? Colors.Orange : Colors.Green,
			author: {
				name: `${member?.displayName ?? "Unknown"} (${discordTagResponse?.response ?? "Unknown"})`,
				icon_url:
					member?.user.avatarURL() ?? "https://polybit-apps.s3.amazonaws.com/stdlib/users/discord/profile/image.png",
			},
			fields: responses
				.filter((r) => r.id !== discordTagResponse?.id)
				.map((r) => ({
					name: r.title,
					value: Array.isArray(r.response) ? "• " + r.response.join("\n • ") : r.response || "-",
				})),
			footer: {
				text: (member?.id ?? "Unknown") + " | " + id,
			},
		}).data;

		let message: Message;
		try {
			message = await appChannel.send({
				content: "\u00A0",
				embeds: [embed],
				components: member?.roles.cache.has("731268929489600634")
					? undefined
					: [
							{
								type: ComponentType.ActionRow,
								components: [
									{
										type: ComponentType.Button,
										label: "Accept",
										customId: "sneakyrp-applications:accept",
										style: ButtonStyle.Success,
										disabled: member ? false : true,
									},
								],
							},
					  ],
				reply: previousMessageId
					? {
							messageReference: previousMessageId,
							failIfNotExists: false,
					  }
					: undefined,
			});
		} catch (e) {
			console.error(e);
			const newEmbed = { ...embed, fields: undefined };
			const markdown = embed.fields!.map((f) => `**${f.name}**:\n ${f.value}`).join("\n\n");

			message = await appChannel.send({
				content: "Application is too long to send as message",
				embeds: [newEmbed],
				files: [
					new MessageAttachment(
						Buffer.from(markdown),
						`${discordTagResponse?.response}_${new Date().toISOString()}.md`
					),
				],
				components: member?.roles.cache.has("731268929489600634")
					? undefined
					: [
							{
								type: ComponentType.ActionRow,
								components: [
									{
										type: ComponentType.Button,
										label: "Accept",
										customId: "sneakyrp-applications:accept",
										style: ButtonStyle.Success,
										disabled: member ? false : true,
									},
								],
							},
					  ],
				reply: previousMessageId
					? {
							messageReference: previousMessageId,
							failIfNotExists: false,
					  }
					: undefined,
			});
		}
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
					components: [],
				});
			}
		}
	});
}
