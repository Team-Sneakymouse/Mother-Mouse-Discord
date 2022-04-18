import { Client, Attachment, TextChannel } from "discord.js";
import { SlashCommandBuilder, SlashCommandStringOption, SlashCommandSubcommandBuilder } from "@discordjs/builders";
import { Redis } from "ioredis";

export const data = [
	new SlashCommandBuilder()
		.setName("trivia")
		.setDescription("Submit answers for trivia")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("answer")
				.setDescription("Submit or edit your answer")
				.addStringOption(
					new SlashCommandStringOption()
						.setName("text")
						.setDescription("Your answer (max 80 characters)")
						.setRequired(true)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("options")
				.setDescription("Manage Answers")
				.addStringOption(
					new SlashCommandStringOption()
						.setName("action")
						.setDescription("Action to perform")
						.setRequired(true)
						.addChoice("Stop Responses", "stop")
						.addChoice("Allow Responses", "start")
				)
		),
];

const admins = ["90956966947467264", "138345057072840704", "181935746465136641", "140876176833904640", "391399998790696960"];
const channel = "906895382456434698";

export default function Trivia(client: Client, redis: Redis) {
	client.on("messageCreate", async (message) => {
		if (message.channel.id !== channel) return;
		if (message.author.bot || message.author.id == "138345057072840704") return;

		const text = message.content;
		const user = message.author.username;

		if (text.length > 80) {
			const reply = await message.reply(`❌ Your answer is too long! (${text.length}/80 characters)`);
			message.delete();
			await new Promise((resolve) => setTimeout(resolve, 5000));
			reply.delete();
			return;
		}

		message.delete();
		redis.hset("trivia:answers", user, text);
	});

	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand()) return;
		if (interaction.commandName !== "trivia") return;

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "answer") {
			if (interaction.channelId !== "906895382456434698" && !((await redis.get("trivia:running")) === "true")) {
				interaction.reply({
					content: "❌ Sorry, but the submission period has ended.",
					ephemeral: true,
				});
				return;
			}

			const text = interaction.options.getString("text", true);
			const user = interaction.user.username;

			if (text.length > 80) {
				interaction.reply({
					content: `❌ Your answer is too long! (${text.length}/80 characters)`,
					ephemeral: true,
				});
				return;
			}

			const replaced = !!(await redis.hget("trivia:answers", user));
			await redis.hset("trivia:answers", user, text);

			if (replaced) {
				interaction.reply({
					content: `✅ Answer replaced.`,
					ephemeral: true,
				});
				return;
			} else {
				interaction.reply({
					content: `✅ Answer registered.`,
					ephemeral: true,
				});
				return;
			}
		}
		if (subCommand === "options") {
			if (!admins.includes(interaction.user.id)) {
				interaction.reply({
					content: "❌ You don't have permission to perform this command.",
					ephemeral: true,
				});
				return;
			}

			const action = interaction.options.getString("action", true);
			if (action === "stop") {
				const answers = redis.hgetall("trivia:answers");
				const redisUpdate1 = redis.set("trivia:running", "false");
				const redisUpdate2 = redis.del("trivia:answers");
				const triviaChannel = interaction.guild!.channels.cache.get(channel) as TextChannel;
				const discordUpdate = triviaChannel.permissionOverwrites.create(triviaChannel.guild.roles.everyone, {
					SendMessages: false,
				});
				await Promise.all([redisUpdate1, redisUpdate2, discordUpdate]);
				const answersString = Object.entries(await answers)
					.map(([user, text]) => `${user.replaceAll("|", "¦")} | ${text.replaceAll("|", "¦").replaceAll("\n", " ")}`)
					.join("\r\n");
				const answersBuffer = Buffer.from(answersString, "utf8");
				interaction.reply({
					content: "✅ Stopped accepting responses and deleted answers. Here is the generated file:",
					files: [new Attachment(answersBuffer, "answers.txt")],
					ephemeral: true,
				});
			}
			if (action === "start") {
				const redisUpdate = redis.set("trivia:running", "true");
				const triviaChannel = interaction.guild!.channels.cache.get(channel) as TextChannel;
				const discordUpdate = triviaChannel.permissionOverwrites.delete(
					triviaChannel.guild.roles.everyone,
					"Allow sending of messages to start gathering responses"
				);
				await Promise.all([redisUpdate, discordUpdate]);
				interaction.reply({
					content: "✅ Started accepting responses.",
					ephemeral: true,
				});
			}
		}
	});
}
