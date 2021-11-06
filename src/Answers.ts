import { Client, MessageAttachment } from "discord.js";
import { SlashCommandBuilder, SlashCommandStringOption, SlashCommandSubcommandBuilder } from "@discordjs/builders";
import { Redis } from "ioredis";
import { AllowedMentionsTypes } from "discord.js/node_modules/discord-api-types";

export const data = new SlashCommandBuilder()
	.setName("card")
	.setDescription("Submit cards for Sunday Stream")
	.addSubcommand(
		new SlashCommandSubcommandBuilder()
			.setName("submit")
			.setDescription("Submit a new card")
			.addStringOption(
				new SlashCommandStringOption().setName("text").setDescription("The text of the card").setRequired(true)
			)
	)
	.addSubcommand(
		new SlashCommandSubcommandBuilder()
			.setName("options")
			.setDescription("Manage Cards")
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
	);

const admins = ["90956966947467264", "138345057072840704", "181935746465136641", "140876176833904640", "391399998790696960"];

export default function PronounRoles(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isCommand()) return;
		if (interaction.commandName !== "card") return;

		const subCommand = interaction.options.getSubcommand();
		if (subCommand === "submit") {
			if (!((await redis.get("money:acceptingResponses")) === "true")) {
				return interaction.reply({
					content: "❌ Sorry, but the card submission period has ended.",
					ephemeral: true,
				});
			}

			const text = interaction.options.getString("text", true);
			const user = interaction.user.username;

			if (text.length > 80) {
				return interaction.reply({
					content: `❌ The maximum text length is 80 characters. This text is ${text.length} characters long.`,
					ephemeral: true,
				});
			}

			redis.rpush("money:cards", `${user} | ${text}`);

			return interaction.reply({
				content: `✅ Card registered.`,
				ephemeral: true,
			});
		}
		if (subCommand === "options") {
			if (!admins.includes(interaction.user.id))
				return interaction.reply({
					content: "❌ You don't have permission to perform this command.",
					ephemeral: true,
				});

			const action = interaction.options.getString("action", true);
			if (action === "generate") {
				const cards = await redis.lrange("money:cards", 0, -1);
				const cardsBuffer = Buffer.from(cards.join("\n"), "utf8");

				return interaction.reply({
					content: "Generating file...",
					files: [new MessageAttachment(cardsBuffer, "cards.txt")],
					ephemeral: true,
				});
			}
			if (action === "clear") {
				const length = await redis.llen("money:cards");
				await redis.del("money:cards");
				interaction.reply({
					content: `✅ Cleared ${length} cards.`,
					ephemeral: true,
				});
			}
			if (action === "stop") {
				await redis.set("money:acceptingResponses", "false");
				interaction.reply({
					content: "✅ Stopped accepting responses.",
					ephemeral: true,
				});
			}
			if (action === "start") {
				await redis.set("money:acceptingResponses", "true");
				interaction.reply({
					content: "✅ Started accepting responses.",
					ephemeral: true,
				});
			}
		}
	});
}
