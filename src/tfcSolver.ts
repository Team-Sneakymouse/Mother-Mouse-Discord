import {
	ChatInputCommandInteraction,
	Client,
	GuildMember,
	SlashCommandBuilder,
	SlashCommandStringOption,
	SlashCommandIntegerOption,
	SlashCommandSubcommandBuilder,
} from "discord.js";

const STACK_SIZE = 16;
const MAX_ATTEMPTS = 1000000;
const INGOT_MB_TOTAL = 100;
const ORE_ID_TOTAL = 4;
const ORE_ID_COPPER = 0;
const ORE_ID_TIN = 1;
const ORE_ID_ZINC = 2;
const ORE_ID_BISMUTH = 3;
const ORE_ID_IRON = 4;
const ORE_ID_GOLD = 5;
const ORE_ID_SILVER = 6;


type AlloyRecipe = {
	oreId: number[];
	oreMax: number[];
	oreMin: number[];
};

const RECIPE_BISMUTH_BRONZE: AlloyRecipe = {
	oreId: [ORE_ID_COPPER, ORE_ID_ZINC, ORE_ID_BISMUTH],
	oreMax: [65, 30, 20],
	oreMin: [50, 20, 10],
}
const RECIPE_BRONZE: AlloyRecipe = {
	oreId: [ORE_ID_COPPER, ORE_ID_TIN],
	oreMax: [92, 12],
	oreMin: [88, 8],
}

const RECIPE_BLACK_BRONZE: AlloyRecipe = {
	oreId: [ORE_ID_COPPER, ORE_ID_SILVER, ORE_ID_GOLD],
	oreMax: [70, 25, 25],
	oreMin: [50, 10, 10],
}

type AlloyProblem = {
	oreId: number[];//enum int
	oreSize: number[];//int mb
	oreQuantity: number[];//int
	recipe: AlloyRecipe;
	slotsTotal: number;//int
	desiredAlloyTotal: number;//int mb
};

type AlloySolution = {
	oreQuantityToUse: number[];
	totalAlloy: number;
	attemptsExceeded: boolean;
}

function SolveDiffToBadness(diff: number) {
	let badness;
	if (diff < 0) {
		//soft reject, too little
		diff *= -1;
		if (diff % INGOT_MB_TOTAL == 0) {
			badness = 2;
		} else {
			badness = 4;
		}
		//weigh rejects by how far they are from ideal
		badness += 1 - (1 / (diff + 1));
	} else if (diff > 0) {
		//soft reject, too much
		if (diff % INGOT_MB_TOTAL == 0) {
			badness = 1;
		} else {
			badness = 3;
		}
		badness += 1 - (1 / (diff + 1));
	} else {
		badness = 0;
	}
	return badness;
}

function Solve(problem: AlloyProblem) {
	let totalOres_ = new Array<number>(ORE_ID_TOTAL);
	let problem_size = problem.oreId.length;
	let alloy_size = problem.recipe.oreId.length;

	let oreQuantityToUse = [];
	let bestSolution: AlloySolution = {
		oreQuantityToUse: [],
		totalAlloy: 0,
		attemptsExceeded: false,
	}
	for (let i = 0; i < problem_size; i++) {
		oreQuantityToUse.push(0);
		bestSolution.oreQuantityToUse.push(0);
	}

	let slotsUsed = 0;
	for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
		let i = 0;
		while (true) {
			if (i >= problem_size) {
				//full iteration achieved
				//TODO: we might want more detail on the issues with this recipe
				return bestSolution;
			}
			if (oreQuantityToUse[i] < problem.oreQuantity[i]) {
				if (oreQuantityToUse[i] == 0) {
					slotsUsed += 1;
				}
				oreQuantityToUse[i] += 1;
				break;
			} else {
				slotsUsed -= 1;
				oreQuantityToUse[i] = 0;
				i += 1;
			}
		}

		//check slotsTotal
		if (slotsUsed > problem.slotsTotal) {
			//hard reject, recipe will not fit
			continue;
		}

		let totalAlloy = 0
		let totalOres = totalOres_;
		totalOres.fill(0);

		for (let i = 0; i < problem_size; i++) {
			let amount = oreQuantityToUse[i]*problem.oreSize[i];
			totalAlloy += amount;
			totalOres[problem.oreId[i]] += amount;
		}

		//check recipe
		let isCorrectAlloy = true;
		for (let j = 0; j < alloy_size; j++) {
			let totalOrePercent = totalOres[problem.recipe.oreId[j]]*100/totalAlloy;
			if (totalOrePercent < problem.recipe.oreMin[j] || totalOrePercent > problem.recipe.oreMax[j]) {
				isCorrectAlloy = false;
				break;
			}
		}
		if (!isCorrectAlloy) {
			//hard reject, recipe is not an alloy
			continue;
		}

		//check desiredAlloyTotal
		let diff = totalAlloy - problem.desiredAlloyTotal;

		if (totalAlloy == problem.desiredAlloyTotal) {
			bestSolution.oreQuantityToUse = oreQuantityToUse;
			bestSolution.totalAlloy = totalAlloy;
			return bestSolution;
		}
		if (bestSolution.totalAlloy == 0 || SolveDiffToBadness(totalAlloy - problem.desiredAlloyTotal) < SolveDiffToBadness(bestSolution.totalAlloy - problem.desiredAlloyTotal)) {
			bestSolution.oreQuantityToUse = [...oreQuantityToUse];
			bestSolution.totalAlloy = totalAlloy;
		}
	}
	bestSolution.attemptsExceeded = true;
	return bestSolution;
}

function ParseInto(str: string, problem: AlloyProblem) {
	const STATE_ID = 0;
	const STATE_SIZE = 1;
	const STATE_QUANTITY = 2;
	const STATE_COMMA = 3;
	const STATE_LITERAL_SIZE = 4;

	let num = 0;
	let num_started = false;
	let state = STATE_ID;

	for (let i = 0; i < str.length; i++) {
		let ch = str[i];
		if (state == STATE_ID) {
			if (ch == 'c') {
				problem.oreId.push(ORE_ID_COPPER);
				state = STATE_SIZE;
			} else if (ch == 't') {
				problem.oreId.push(ORE_ID_TIN);
				state = STATE_SIZE;
			} else if (ch == 'z') {
				problem.oreId.push(ORE_ID_ZINC);
				state = STATE_SIZE;
			} else if (ch == 'b') {
				problem.oreId.push(ORE_ID_BISMUTH);
				state = STATE_SIZE;
			} else if (ch == 'i') {
				problem.oreId.push(ORE_ID_IRON);
				state = STATE_SIZE;
			} else if (ch == 'g') {
				problem.oreId.push(ORE_ID_GOLD);
				state = STATE_SIZE;
			} else if (ch == 's') {
				problem.oreId.push(ORE_ID_SILVER);
				state = STATE_SIZE;
			} else if (ch == ' ') {

			} else {
				//parse error
				return "Parse Error: Expected a metal, '" + ch + "' is not a recognized metal";
			}
		} else if (state == STATE_SIZE) {
			if (ch == 's') {
				problem.oreSize.push(10);
				state = STATE_QUANTITY;
			} else if (ch == 'p') {
				problem.oreSize.push(15);
				state = STATE_QUANTITY;
			} else if (ch == 'n') {
				problem.oreSize.push(25);
				state = STATE_QUANTITY;
			} else if (ch == 'r') {
				problem.oreSize.push(35);
				state = STATE_QUANTITY;
			} else if (ch == 'i') {
				problem.oreSize.push(INGOT_MB_TOTAL);
				state = STATE_QUANTITY;
			} else if (ch == ' ') {
				problem.oreSize.push(25);
				state = STATE_QUANTITY;
			} else if (ch == ':') {
				state = STATE_LITERAL_SIZE;
			} else {
				//parse error
				return "Parse Error: Expected an ore quality, '" + ch + "' is not a recognized quality";
			}
		} else if (state == STATE_QUANTITY) {
			if (ch == ' ' && !num_started) {

			} else if (ch >= '0' && ch <= '9') {
				num_started = true;
				num *= 10;
				num += Number(ch);
			} else if (ch == ',' || ch == ' ') {
				problem.oreQuantity.push(num);
				num = 0;
				num_started = false;
				if (ch == ',') {
					state = STATE_ID;
				} else {
					state = STATE_COMMA;
				}
			} else {
				//parse error
				return "Parse Error: Expected an integer quantity, got '" + ch + "'";
			}
		} else if (state == STATE_COMMA) {
			if (ch == ',') {
				state = STATE_ID;
			} else if (ch == ' ') {

			} else {
				//parse error
				return "Parse Error: Expected a comma, got '" + ch + "'";
			}
		} else if (state == STATE_LITERAL_SIZE) {
			if (ch >= '0' && ch <= '9') {
				num_started = true;
				num *= 10;
				num += Number(ch);
			} else if (ch == ' ' && num_started) {
				problem.oreSize.push(num);
				num = 0;
				num_started = false;
				state = STATE_QUANTITY;
			} else if (ch == ',') {
				//parse error
				return "Parse Error: Expected a space and then an integer quanity, but the item description was ended prematurely";
			} else {
				//parse error
				return "Parse Error: Expected an integer quality, got '" + ch + "'";
			}
		}
	}

	if (state == STATE_ID) {
	} else if (state == STATE_SIZE) {
		//parse error
		return "Parse Error: Expected an ore quality, but the list ended";
	} else if (state == STATE_QUANTITY) {
		problem.oreQuantity.push(num);
	} else if (state == STATE_COMMA) {
	} else if (state == STATE_LITERAL_SIZE) {
		return "Parse Error: Expected an ore quality literal, but the list ended";
	}

	return null;
}



const MATERIAL_DESC = "The list of ores you have to work with, in order of desired usage priority";
const MATERIAL_HELP = "Usage: tfcsolver <alloy-name> <ingot-total> <material-list>. The alloy-name is the name of the TFC alloy you want to make. The ingot-total is the desired number of ignots of that alloy you want to make. The material-list is the list of ores you have to work with, where the first ore in the list will be used first over ores later in the list. Example: 'tfcsolver bronze 3 cn 10, ts 8'. This is saying 'I want to make 3 ingots of bronze, I have 10 normal quality copper and 8 small tin ore to work with, and I would like to prioritize using more copper than tin'.";
export const data = [
	new SlashCommandBuilder()
		.setName("tfcsolver")
		.setDescription("Find a mixture of terra firma craft ores that is ideal for creating an alloy")
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("help")
				.setDescription("Mother Mouse explains how to use this command (this solver is a prototype)")
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("bismuth-bronze")
				.setDescription("Attempt to create bismuth bronze with the materials specified")
				.addIntegerOption(
					new SlashCommandIntegerOption()
						.setName("ingots")
						.setDescription("The number of alloy ingots you want to make (100mb)")
						.setRequired(true)
				)
				.addStringOption(
					new SlashCommandStringOption()
						.setName("material-list")
						.setRequired(true)
						.setDescription(MATERIAL_DESC)
						.setAutocomplete(false)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("bronze")
				.setDescription("Attempt to create bronze with the materials specified")
				.addIntegerOption(
					new SlashCommandIntegerOption()
						.setName("ingots")
						.setDescription("The number of alloy ingots you want to make (100mb)")
						.setRequired(true)
				)
				.addStringOption(
					new SlashCommandStringOption()
						.setName("material-list")
						.setRequired(true)
						.setDescription(MATERIAL_DESC)
						.setAutocomplete(false)
				)
		)
		.addSubcommand(
			new SlashCommandSubcommandBuilder()
				.setName("black-bronze")
				.setDescription("Attempt to create black bronze with the materials specified")
				.addIntegerOption(
					new SlashCommandIntegerOption()
						.setName("ingots")
						.setDescription("The number of alloy ingots you want to make (100mb)")
						.setRequired(true)
				)
				.addStringOption(
					new SlashCommandStringOption()
						.setName("material-list")
						.setRequired(true)
						.setDescription(MATERIAL_DESC)
						.setAutocomplete(false)
				)
		),
];

export default function tfcSolver(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "tfcsolver") return await handleCommand(interaction);
	});


	async function handleCommand(interaction: ChatInputCommandInteraction) {
		let subCommand = interaction.options.getSubcommand();
		let recipe: AlloyRecipe;
		if (subCommand == "bismuth-bronze") {
			recipe = RECIPE_BISMUTH_BRONZE;
		} else if (subCommand == "bronze") {
			recipe = RECIPE_BRONZE;
		} else if (subCommand == "black-bronze") {
			recipe = RECIPE_BLACK_BRONZE;
		} else if (subCommand == "help") {
			interaction.reply({
				content: MATERIAL_HELP,
				ephemeral: true,
			});
			return;
		} else {
			interaction.reply({
				content: "An alloy type must be specified",
				ephemeral: false,
			});
			return;
		}
		let optionValue = interaction.options.getInteger("ingots");
		if (optionValue == null) {
			interaction.reply({
				content: "The desired quantity of ingots must be specified",
				ephemeral: false,
			});
			return;
		}

		let problem: AlloyProblem = {
			oreId: [],//enum int
			oreSize: [],//int mb
			oreQuantity: [],//int
			recipe: recipe,
			slotsTotal: 4,//int
			desiredAlloyTotal: optionValue*INGOT_MB_TOTAL,//int mb
		};

		let optionString = interaction.options.getString("material-list");
		if (optionString == null) {
			interaction.reply({
				content: "The available set of ingredients must be specified",
				ephemeral: false,
			});
			return;
		}
		let error = ParseInto(optionString, problem);
		if (error != null) {
			interaction.reply({
				content: error,
				ephemeral: false,
			});
			return;
		}

		//TODO: input sanitization here
		//let hasReplied = false;
		let hasReplied1 = false;
		let hasReplied2 = false;
		let preText = "";
		for (let i = 0; i < problem.oreId.length;) {
			let oreId = problem.oreId[i];
			let isFound = problem.recipe.oreId.includes(oreId);
			if (!isFound) {
				if (!hasReplied1) {
					hasReplied1 = true;
					let metalName;
					if (oreId == ORE_ID_COPPER) {
						metalName = "copper";
					} else if (oreId == ORE_ID_TIN) {
						metalName = "tin";
					} else if (oreId == ORE_ID_ZINC) {
						metalName = "zinc";
					} else if (oreId == ORE_ID_BISMUTH) {
						metalName = "bismuth";
					} else if (oreId == ORE_ID_IRON) {
						metalName = "iron";
					} else if (oreId == ORE_ID_GOLD) {
						metalName = "gold";
					} else if (oreId == ORE_ID_SILVER) {
						metalName = "silver";
					}
					preText += "The given material list contains " + metalName + " which is not used to create " + subCommand + ", removing it and any other unnecessary metals...\n";
				}
				problem.oreId.splice(i, 1);
				problem.oreSize.splice(i, 1);
				problem.oreQuantity.splice(i, 1);
			} else {
				if (problem.oreQuantity[i] > STACK_SIZE) {
					problem.oreQuantity[i] = STACK_SIZE;
					if (!hasReplied2) {
						hasReplied2 = true;
						preText += "Metal ores cannot stack above " + STACK_SIZE + ", rounding down to " + STACK_SIZE + "...\n";
					}
				}
				i += 1;
			}
		}

		let solution = Solve(problem);

		let solutionText = "";

		let problem_size = problem.oreId.length;
		let flag = false;
		for (let i = 0; i < problem_size; i++) {
			if (solution.oreQuantityToUse[i] > 0) {
				if (flag) {
					solutionText += ", ";
				}
				flag = true;
				let oreId = problem.oreId[i];
				if (oreId == ORE_ID_COPPER) {
					solutionText += 'c';
				} else if (oreId == ORE_ID_TIN) {
					solutionText += 't';
				} else if (oreId == ORE_ID_ZINC) {
					solutionText += 'z';
				} else if (oreId == ORE_ID_BISMUTH) {
					solutionText += 'b';
				} else if (oreId == ORE_ID_IRON) {
					solutionText += 'i';
				} else if (oreId == ORE_ID_GOLD) {
					solutionText += 'g';
				} else if (oreId == ORE_ID_SILVER) {
					solutionText += 's';
				}

				let oreSize = problem.oreSize[i];
				if (oreSize == 10) {
					solutionText += 's';
				} else if (oreSize == 15) {
					solutionText += 'p';
				} else if (oreSize == 25) {
					solutionText += 'n';
				} else if (oreSize == 35) {
					solutionText += 'r';
				} else if (oreSize == 100) {
					solutionText += 'i';
				} else {
					solutionText += ':' + oreSize;
				}

				solutionText += ' ' + solution.oreQuantityToUse[i];
			}
		}


		if (solutionText != "") {
			let disclaimer;
			if (solution.totalAlloy == problem.desiredAlloyTotal) {
				disclaimer = "This will create exactly " + solution.totalAlloy/INGOT_MB_TOTAL + " ingots worth of alloy";
			} else if (solution.totalAlloy%INGOT_MB_TOTAL == 0) {
				disclaimer = "This will create " + solution.totalAlloy / INGOT_MB_TOTAL + " ingots worth of alloy, instead of the desired " + problem.desiredAlloyTotal / INGOT_MB_TOTAL;
			} else {
				disclaimer = "This will create " + solution.totalAlloy + "mb worth of alloy, instead of the desired " + problem.desiredAlloyTotal + "mb";
			}
			if (solution.attemptsExceeded) {
				disclaimer += "\nThe given material list was too complex, the mixture given was the best found";
			}
			interaction.reply({
				content: preText + "Try a mix of '" + solutionText + "'\n" + disclaimer,
				ephemeral: false,
			});
		} else {
			if (solution.attemptsExceeded) {
				interaction.reply({
					content: preText + "The material list was too complex! Try reducing its size",
					ephemeral: false,
				});
			} else {
				interaction.reply({
					content: preText + "It is not possible to create " + subCommand + " with the given ores",
					ephemeral: false,
				});
			}
		}

	}
}
