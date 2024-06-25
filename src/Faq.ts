import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
export const data = [
	new SlashCommandBuilder()
		.setName("faq")
		.setDescription("Query the FAQ")
		.addStringOption(
			new SlashCommandStringOption()
				.setName("query")
				.setDescription("The query to search for")
				.setRequired(true)
				.setAutocomplete(true)
		),
];

type FaqQuestion = { question: string; answer: string; tags: string };
const questionCache: Record<string, (RecordModel & FaqQuestion)[] | null> = {};

export default function Vibecheck(client: Client, pocketbase: PocketBase) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isAutocomplete() && interaction.commandName === "faq") {
			if (!interaction.guild)
				return interaction.respond([
					{
						name: "Error: Can't retrieve guild info. Please tell Dani",
						value: "error",
					},
				]);

			const autocomplete = interaction.options.getFocused().toLowerCase();

			let questions = questionCache[interaction.guild.id];
			if (!questions) {
				questions = await pocketbase.collection("mm_faq").getFullList<RecordModel & FaqQuestion>(undefined, {
					filter: `server="${interaction.guild.id}"`,
				});
				questionCache[interaction.guild.id] = questions;
				setTimeout(() => (questionCache[interaction.guild!.id] = null), 5000);
			}
			const relevantQuestions = questions.filter(
				(question) =>
					question.question.toLowerCase().includes(autocomplete) ||
					question.answer.toLowerCase().includes(autocomplete) ||
					question.tags.toLowerCase().includes(autocomplete)
			);

			interaction.respond(relevantQuestions.map((question) => ({ name: question.question, value: question.id })));
			return;
		}

		if (interaction.isChatInputCommand() && interaction.commandName === "faq") {
			const questionId = interaction.options.getString("query", true);
			try {
				const question = await pocketbase.collection("mm_faq").getOne<RecordModel & FaqQuestion>(questionId);

				interaction.reply({
					content: "",
					embeds: [
						{
							title: question.question,
							description: question.answer,
						},
					],
				});
				return;
			} catch (e) {
				interaction.reply({
					content: "I can't find that question. Please ask it normally.",
					ephemeral: true,
				});
				return;
			}
		}
	});
}
