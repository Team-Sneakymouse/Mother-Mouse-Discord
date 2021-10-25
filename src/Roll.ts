import { Client } from "discord.js";
import { SlashCommandBooleanOption, SlashCommandBuilder, SlashCommandStringOption } from "@discordjs/builders";
import { evaluate } from "mathjs";
export const data = new SlashCommandBuilder()
	.setName("roll")
	.setDescription("Roll dice to generate random numbers")
	.addStringOption(
		new SlashCommandStringOption()
			.setName("dice")
			.setDescription("The dice to roll (supports complex notation)")
			.setRequired(true)
	)
	.addBooleanOption(
		new SlashCommandBooleanOption().setName("private").setDescription("Shows this result only to you").setRequired(false)
	);

export default function Vibecheck(client: Client) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isCommand() && interaction.commandName === "roll") {
			const dice = interaction.options.getString("dice") || "";
			const ephemeral = interaction.options.getBoolean("private") || false;

			try {
				const rolled = dice.replace(/(\d*d\d+)/gi, (match) => {
					const split = match.split(/d/i);
					if (split[0] === "") split[0] = "1";
					const [number, sides] = split.map((x) => parseInt(x));

					if (isNaN(number) || isNaN(sides)) throw new Error("Invalid dice: `" + match + "`");
					if (number > 100000000) throw new Error("Too many dice: `" + match + "`");

					let total = 0;
					for (let i = 0; i < number; i++) {
						total += Math.floor(Math.random() * sides) + 1;
					}
					return total.toString();
				});

				let result = evaluate(rolled);
				if (result == 20) result = "<:d20:413105959121190942>";
				else if (result == 1) result = "<:d1:413105959049887745>";
				return interaction.reply({ content: "`" + dice + "`: " + result, ephemeral });
			} catch (e) {
				const message: string =
					typeof e == "string" ? e : (e as any).message ? (e as any).message : (e as any).toString();
				return interaction.reply({ content: message, ephemeral });
			}
		}
	});
}
