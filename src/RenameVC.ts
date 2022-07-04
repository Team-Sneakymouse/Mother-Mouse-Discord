import {
	ChatInputCommandInteraction,
	Client,
	GuildMember,
	SlashCommandBuilder,
	SlashCommandStringOption,
} from "discord.js";


const validChannelsAndDefaultNames = new Map<string, string> ([
	["898925497508048900", "General"],
	["975460686924750878", "Gaming with Friends"],
	["975608151124627456", "Random"],
]);


export const data = [
	new SlashCommandBuilder()
		.setName("renamevc")
		.setDescription("Annouce what you are doing in the voice channel by renaming it!")
		.addStringOption(
			new SlashCommandStringOption()
			.setName("channel-name")
			.setRequired(true)
			.setDescription("Keep in mind long names will get cut off when displayed in the sidebar")
		),
];

export default function RenameVC(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "renamevc") return await handleCommand(interaction);
	});



	client.on("voiceStateUpdate", async (oldState, newState) => {
		let channel = oldState.channel;
		if (!channel) {
			return;
		}
		let defaultName = validChannelsAndDefaultNames.get(channel.id);
		if (!defaultName) {
			return;
		}

		let updatedChannel = await channel.fetch();

		if(updatedChannel.members.size == 0) {
			await new Promise((resolve) => setTimeout(resolve, 5*60*1000));
			updatedChannel = await updatedChannel.fetch(true);
			if (updatedChannel.members.size == 0) {
				updatedChannel.setName(defaultName);
			}
		}
	});



	async function handleCommand(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) {
			interaction.reply({
				content: "Couldn't rename a voice channel because I can't find a valid discord server.",
				ephemeral: true,
			});
			return;
		}
		let commander = interaction.member;
		if (!(commander instanceof GuildMember)) {
			interaction.reply({
				content: "Couldn't rename a voice channel because I can't seem to find your account.",
				ephemeral: true,
			});
			return;
		}

		let name = interaction.options.getString("channel-name");
		if (!name) {
			interaction.reply({
				content: "Please specify a channel name.",
				ephemeral: true,
			});
			return;
		}

		let commanderChannel = commander.voice.channel;

		if (!commanderChannel) {
			interaction.reply({
				content: "But you aren't in a voice channel.",
				ephemeral: true,
			});
			return;
		}

		if (!validChannelsAndDefaultNames.has(commanderChannel.id)) {
			interaction.reply({
				content: "I'm sorry but you don't have permission to change this channel's name.",
				ephemeral: true,
			});
			return;
		}

		commanderChannel.setName(name);
	}
}
