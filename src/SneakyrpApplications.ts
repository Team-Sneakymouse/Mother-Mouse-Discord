import {
	Client,
	Colors,
	EmbedBuilder,
	GuildMember,
	Message,
	TextChannel,
	ComponentType,
	ButtonStyle,
	ThreadChannel,
	ButtonInteraction,
	ModalSubmitInteraction,
	ModalBuilder,
	TextInputStyle,
	AttachmentBuilder,
} from "discord.js";
import { Redis } from "ioredis";
import type { Express, Request, Response } from "express";

type ApplicationData = {
	id: string;
	form: "roleplay" | "buildteam";
	timestamp: string;
	responses: {
		id: number;
		title: string;
		response: string | string[];
	}[];
};

export default function SneakyrpApplications(client: Client, redis: Redis, server: Express) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isButton() && interaction.customId == "sneakyrp-applications:accept") applicationAcceptHandler(interaction);
		else if (interaction.isButton() && interaction.customId == "sneakyrp-applications:reject") applicationRejectHandler(interaction);
		else if (interaction.isModalSubmit() && interaction.customId.startsWith("sneakyrp-applications:rejectconfirm"))
			applicationRejectConfirmHandler(interaction);
	});

	server.post("/sneakyrpapplications", applicationWebhookHandler);

	async function applicationAcceptHandler(interaction: ButtonInteraction) {
		const sneakyrpServer = client.guilds.cache.get("725854554939457657")!;
		const userId = interaction.message.embeds[0]?.footer?.text.match(/\d{15,}/)?.[0];
		if (!userId)
			return interaction.reply({
				content: `Could extract user id from footer \`${interaction.message.embeds[0]?.footer?.text}\``,
				ephemeral: true,
			});
		let member: GuildMember | undefined;
		try {
			member = await sneakyrpServer.members.fetch(userId);
		} catch (err) {
			return interaction.reply({
				content: `Could not fetch member \`${userId}\``,
				ephemeral: true,
			});
		}

		await Promise.all([
			member.roles.add("964215265367851048"), // New Roleplayer
			member.roles.add("731268929489600634"), // Roleplayer
		]);

		const roleplayChannel = client.channels.cache.get("958760167061717062") as TextChannel;
		roleplayChannel.send({
			content: `Welcome, <@${userId}>! <:storytime:733433864227258368>\nPlease check out <#967477102108610580> for info on how to get set up on the server and <#964216562611519568> to get set up with a tour.`,
		});

		const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
			.setTitle(interaction.message.embeds[0].title?.replace("Open", "Accepted") ?? "Accepted Application")
			.setColor(Colors.Grey);
		await (interaction.message as Message).edit({
			embeds: [newEmbed.data],
			components: [],
		});
		await interaction.reply({
			content: "Success",
			ephemeral: true,
		});
		await (interaction.message.thread as ThreadChannel).send(
			`${(interaction.member as GuildMember).displayName} accepted the application of <@${userId}>`
		);
		await (interaction.message.thread as ThreadChannel).setArchived(true);
	}

	async function applicationRejectHandler(interaction: ButtonInteraction) {
		const userId = interaction.message.embeds[0]?.footer?.text.match(/\d{15,}/)?.[0];
		interaction.showModal(
			new ModalBuilder({
				customId: "sneakyrp-applications:rejectconfirm-" + interaction.message.id,
				title: `Please provide a reason for rejecting <@${userId}>'s application.`,
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.TextInput,
								customId: "sneakyrp-applications:rejectconfirm-reason",
								label: "They will NOT be automatically notified of this rejection.",
								style: TextInputStyle.Short,
							},
						],
					},
				],
			})
		);
	}

	async function applicationRejectConfirmHandler(interaction: ModalSubmitInteraction) {
		const msgId = interaction.customId.split("-").pop()!;
		const msg = await interaction.channel?.messages.fetch(msgId);
		if (!msg) return interaction.reply({ content: "Could not find message. Tell Dani pls!", ephemeral: true });

		const userId = msg.embeds[0]?.footer?.text.match(/\d{15,}/)?.[0];

		const newEmbed = EmbedBuilder.from(msg.embeds[0])
			.setTitle(msg.embeds[0].title?.replace("Open", "Rejected") ?? "Rejected Application")
			.setColor(Colors.DarkRed);
		await msg.edit({
			embeds: [newEmbed.data],
			components: [],
		});
		await interaction.reply({
			content: "Success",
			ephemeral: true,
		});
		const reason = interaction.fields.getTextInputValue("sneakyrp-applications:rejectconfirm-reason");
		await (msg.thread as ThreadChannel).send(
			`${(interaction.member as GuildMember).displayName} rejected the application of <@${userId}> with reason:\n > ${reason}`
		);
		await (msg.thread as ThreadChannel).setArchived(true);
	}

	async function applicationWebhookHandler(req: Request, res: Response) {
		const sneakyrpServer = client.guilds.cache.get("725854554939457657")!;
		const appChannel = client.channels.cache.get("963808503808557127") as TextChannel;

		const { id, form, timestamp, responses } = req.body as ApplicationData;
		console.log(`New SneakyRP application by ${responses.find((r) => r.title.includes("Discord"))?.response} for ${form} (${id})`);

		const discordTagResponse = responses.find((r) => r.title.includes("Discord tag"));
		const nameResponse = responses.find((r) => r.title.includes("be referred to"));
		const pronounsResponse = responses.find((r) => r.title.includes("pronouns"));

		let member: GuildMember | undefined;
		if (discordTagResponse) {
			const discordTag = discordTagResponse.response as string;
			const [discordName, discordDiscriminator] = discordTag.split("#");

			const results = await sneakyrpServer.members.search({ query: discordName, limit: 10 });
			if (results.size === 0) {
				console.error(`No guild member found for ${discordName}`);
			} else {
				member = results.find(
					(m) => m.user.username.toLowerCase() === discordName.toLowerCase() && m.user.discriminator === discordDiscriminator
				);
			}
		} else {
			console.error("No Discord tag found in application response");
		}
		let accepted = false;
		// Roleplayer or New Roleplayer roles are considered accepted
		if (member && (member.roles.cache.has("731268929489600634") || member.roles.cache.has("964215265367851048"))) {
			accepted = true;
		}

		// Create preview embed with author info
		const name = nameResponse?.response ?? "Invalid field 'be referred to'";
		const pronouns = pronounsResponse?.response ?? "Invalid field 'pronouns'";
		const previewEmbed = EmbedBuilder.from({
			color: accepted ? Colors.Grey : Colors.Green,
			author: {
				name: `${name} (${pronouns})`,
				icon_url: member?.user.avatarURL() ?? "https://polybit-apps.s3.amazonaws.com/stdlib/users/discord/profile/image.png",
			},
			title: `${accepted ? "Closed" : "Open"} ${form[0].toUpperCase() + form.substring(1)} Application`,
			description: `\`${id}\`\n\n${
				member
					? `<@${member.id}> (<discord://-/users/${member.id}>)`
					: `User ${discordTagResponse?.response} not found in the server!`
			}`,
			timestamp: timestamp,
			footer: {
				text: `${member?.displayName ?? "Unknown"} (${discordTagResponse?.response} - ${member?.id ?? "Unknown"})`,
			},
		}).data;

		// Send or edit root message with author info
		const rootMessageId = await redis.get(`mm-discord-sneakyrp:application-${id}`);
		let rootMessage = rootMessageId ? await appChannel.messages.fetch(rootMessageId) : null;
		if (!rootMessage) {
			rootMessage = await appChannel.send({
				content: "\u00A0",
				embeds: [previewEmbed],
				components: accepted
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
										disabled: !member ? true : false,
									},
									{
										type: ComponentType.Button,
										label: "Reject",
										customId: "sneakyrp-applications:reject",
										style: ButtonStyle.Danger,
										disabled: !member ? true : false,
									},
								],
							},
					  ],
			});
			await redis.set(`mm-discord-sneakyrp:application-${id}`, rootMessage.id);
		} else {
			if (rootMessage.embeds[0].url) previewEmbed.url = rootMessage.embeds[0].url;
			await rootMessage.edit({
				embeds: [previewEmbed],
				components: accepted
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
										disabled: !member ? true : false,
									},
									{
										type: ComponentType.Button,
										label: "Reject",
										customId: "sneakyrp-applications:reject",
										style: ButtonStyle.Danger,
										disabled: !member ? true : false,
									},
								],
							},
					  ],
			});
		}

		let thread = rootMessage.thread;
		const threadName = (discordTagResponse?.response as string | undefined)?.split("#")[0];
		if (!thread) {
			thread = await rootMessage.startThread({
				name: threadName ?? "Invalid field 'Discord'",
				autoArchiveDuration: 10080,
				reason: "New Application",
			});
		} else {
			if (threadName && threadName !== thread.name) await thread.setName(threadName);
		}

		// Create content embed with form responses
		const markdown = responses
			.filter((r) => r.id !== discordTagResponse?.id)
			.map((r) => `**${r.title}**:\n${Array.isArray(r.response) ? "• " + r.response.join("\n • ") : r.response || "-"}`)
			.join("\n\n");
		const contentEmbed = EmbedBuilder.from({
			title: rootMessage.embeds[0].url ? "Updated Application" : "New Application",
			color: rootMessage.embeds[0].url ? Colors.Orange : Colors.Green,
			description: markdown,
		}).data;

		let contentMessage: Message | undefined;
		if (rootMessage.embeds[0].url) {
			contentMessage = await thread.messages.fetch(rootMessage.embeds[0].url.split("/").pop()!);
			try {
				await contentMessage.edit({
					content: "\u00A0",
					embeds: [contentEmbed],
					files: [],
				});
			} catch (e) {
				const newEmbed: typeof contentEmbed = { ...contentEmbed, description: undefined };
				console.error(e);
				contentMessage = await contentMessage.edit({
					content: "Application is too long to send as message",
					embeds: [newEmbed],
					files: [
						new AttachmentBuilder(
							Buffer.from(contentEmbed.description ?? "Error: Can't find embed description", "utf8")
						).setFile(`${discordTagResponse?.response}_${new Date().toISOString()}.md`),
					],
				});
			}
		} else {
			try {
				contentMessage = await thread.send({
					content: "\u00A0",
					embeds: [contentEmbed],
				});
			} catch (e) {
				console.error(e);
				const newEmbed: typeof contentEmbed = { ...contentEmbed, description: undefined };
				contentMessage = await thread.send({
					content: "Application is too long to send as message",
					embeds: [newEmbed],
					files: [
						new AttachmentBuilder(
							Buffer.from(contentEmbed.description ?? "Error: Can't find embed description", "utf8")
						).setFile(`${discordTagResponse?.response}_${new Date().toISOString()}.md`),
					],
				});
			}

			// Update root message with content message url
			await rootMessage.edit({
				embeds: [{ ...previewEmbed, url: contentMessage.url }],
			});
		}

		if (accepted) await thread.setArchived(true);

		res.status(200).end();
	}
}
