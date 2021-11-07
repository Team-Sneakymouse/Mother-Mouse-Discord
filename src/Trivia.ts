import { Client, MessageAttachment, TextChannel } from "discord.js";
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
						.addChoice("Generate File", "generate")
						.addChoice("Clear Responses", "clear")
						.addChoice("Stop Responses", "stop")
						.addChoice("Allow Responses", "start")
				)
		),
];

const admins = ["90956966947467264", "138345057072840704", "181935746465136641", "140876176833904640", "391399998790696960"];
const channel = "906895382456434698";

export default function Trivia(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isCommand()) return;
		if (interaction.commandName !== "trivia") return;

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "answer") {
			if (!((await redis.get("trivia:running")) === "true")) {
				return interaction.reply({
					content: "❌ Sorry, but the submission period has ended.",
					ephemeral: true,
				});
			}

			const text = interaction.options.getString("text", true);
			const user = interaction.user.username;

			if (text.length > 80) {
				return interaction.reply({
					content: `❌ The maximum text length is 80 characters. This answer is ${text.length} characters long.`,
					ephemeral: true,
				});
			}

			const replaced = !!(await redis.hget("trivia:answers", user));
			await redis.hset("trivia:answers", user, text);

			if (replaced) {
				return interaction.reply({
					content: `✅ Answer replaced.`,
					ephemeral: true,
				});
			} else {
				return interaction.reply({
					content: `✅ Answer registered.`,
					ephemeral: true,
				});
			}
		}
		if (subCommand === "options") {
			if (!admins.includes(interaction.user.id))
				return interaction.reply({
					content: "❌ You don't have permission to perform this command.",
					ephemeral: true,
				});

			const action = interaction.options.getString("action", true);
			if (action === "generate") {
				const answers = await redis.hgetall("trivia:answers");
				const answersString = Object.entries(answers)
					.map(([user, text]) => `${user} | ${text}`)
					.join("\n");
				const answersBuffer = Buffer.from(answersString, "utf8");

				return interaction.reply({
					content: "Generating file...",
					files: [new MessageAttachment(answersBuffer, "answers.txt")],
					ephemeral: true,
				});
			}
			if (action === "clear") {
				const length = await redis.hlen("trivia:answers");
				await redis.del("trivia:answers");
				interaction.reply({
					content: `✅ Cleared ${length} answers.`,
					ephemeral: true,
				});
			}
			if (action === "stop") {
				const redisUpdate = redis.set("trivia:running", "false");
				const triviaChannel = interaction.guild!.channels.cache.get(channel) as TextChannel;
				const discordUpdate = triviaChannel.permissionOverwrites.create(triviaChannel.guild.roles.everyone, {
					VIEW_CHANNEL: false,
				});
				await Promise.all([redisUpdate, discordUpdate]);
				interaction.reply({
					content: "✅ Stopped accepting responses.",
					ephemeral: true,
				});
			}
			if (action === "start") {
				const redisUpdate = redis.set("trivia:running", "true");
				const triviaChannel = interaction.guild!.channels.cache.get(channel) as TextChannel;
				const discordUpdate = triviaChannel.permissionOverwrites.delete(
					triviaChannel.guild.roles.everyone,
					"Make channel visible to start gathering responses"
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
