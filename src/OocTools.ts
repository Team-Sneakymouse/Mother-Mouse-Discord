import {
	MessageFlags,
	Client,
	CommandInteraction,
	ContextMenuCommandBuilder,
	GuildTextBasedChannel,
	SlashCommandBuilder,
	VoiceChannel,
} from "discord.js";
export const data = [
	new SlashCommandBuilder().setName("power").setDescription("Power up Dani"),
	new SlashCommandBuilder().setName("lock").setDescription("Lock/unlock room"),
];

export default function OocTools(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.guildId === "971479608664924202" && interaction.isChatInputCommand()) {
			if (interaction.commandName === "lock") return handleLockCommand(interaction);
			if (interaction.commandName === "power") return handlePowerCommand(interaction);
			console.log("No command handler!", interaction.commandName);
		}
	});
}

async function handleLockCommand(interaction: CommandInteraction) {
	if (!interaction.channel) {
		interaction.reply("no channel");
		return;
	}
	if (interaction.channel.isDMBased()) {
		return;
	}

	const category = interaction.channel.isThread() ? interaction.channel.parent?.parent : interaction.channel.parent;
	if (!category) {
		// check for null
		interaction.reply("no parent category");
		return;
	}

	if (!category.name.startsWith("🔒")) {
		const voiceChannels = category.children.cache.filter((c) => c.isVoiceBased());
		await interaction.deferReply();

		const permissionUpdatePromises: Promise<any>[] = [];
		for (const voiceChannel of voiceChannels.values()) {
			permissionUpdatePromises.push(
				(voiceChannel as VoiceChannel).fetch().then((c) => c.permissionOverwrites.cache.map((p) => p.edit({ Connect: false })))
			);
		}
		await Promise.all(permissionUpdatePromises);
		await category.edit({ name: `🔒 ${category.name}` });

		await interaction.editReply(`Voice Channels in **${category.name.replace("🔒 ", "")}** locked.`);
		return;
	} else {
		const voiceChannels = category.children.cache.filter((c) => c.isVoiceBased());
		await interaction.deferReply();

		const permissionUpdatePromises: Promise<any>[] = [];
		for (const voiceChannel of voiceChannels.values()) {
			permissionUpdatePromises.push((voiceChannel as VoiceChannel).fetch().then((c) => c.lockPermissions()));
		}
		await Promise.all(permissionUpdatePromises);
		await category.edit({ name: category.name.replace("🔒 ", "") });

		await interaction.editReply(`Voice Channels in **${category.name}** unlocked.`);
		return;
	}
}

async function handlePowerCommand(interaction: CommandInteraction) {
	const dani = interaction.guild?.members.cache.get("138345057072840704");
	if (!dani) {
		interaction.reply({
			content: "can't find dani",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (dani.roles.cache.has("971480595232342036")) {
		await dani.roles.remove("971480595232342036");
		interaction.reply({
			content: "Dani is no longer powered up",
			flags: MessageFlags.Ephemeral,
		});
	} else {
		await dani.roles.add("971480595232342036");
		interaction.reply({
			content: "Powered up Dani",
			flags: MessageFlags.Ephemeral,
		});
	}
}
