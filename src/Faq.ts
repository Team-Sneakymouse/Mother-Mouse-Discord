import { Client, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import PocketBase, { Record as PBRecord } from "pocketbase";
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

			const questions = await pocketbase
				.collection("mm_faq")
				.getFullList<PBRecord & { question: string; answer: string; tags: string }>(undefined, {
					filter: `server="${interaction.guild.id}"`,
				});
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
				const question = await pocketbase
					.collection("mm_faq")
					.getOne<PBRecord & { question: string; answer: string; tags: string }>(questionId);

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
