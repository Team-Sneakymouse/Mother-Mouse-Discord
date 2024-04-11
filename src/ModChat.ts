import {
	ChannelType,
	Client,
	ComponentType,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ThreadAutoArchiveDuration,
} from "discord.js";

export const SelectMenu = new StringSelectMenuBuilder()
	.setCustomId("modchat")
	.setPlaceholder("What would you like to chat to us about?")
	.setMaxValues(1)
	.addOptions([
		{
			label: "Technical Problem",
			value: "technical",
			description: "Disruptive bugs, account issues, etc.",
			emoji: "🔧",
		},
		{
			label: "Social Problem",
			value: "social",
			description: "Negative interactions with other roleplayers",
			emoji: "👥",
		},
		{
			label: "Other",
			value: "other",
			description: "Anything else",
			emoji: "❓",
		},
	]);

export default function ModChat(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isStringSelectMenu()) return;
		if (interaction.customId !== "modchat") return;
		if (!interaction.member) return;
		if (!interaction.channel) return;
		if (interaction.channel.type !== ChannelType.GuildText) return;

		await interaction.deferUpdate();

		const option = interaction.values[0];
		const emoji = SelectMenu.options.find((o) => o.data.value === option)?.data.emoji;
		const thread = await interaction.channel.threads.create({
			type: ChannelType.PrivateThread,
			name: `${emoji} ${client.users.cache.get(interaction.user.id)?.displayName}`,
			autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
			invitable: false,
			reason: "User requested mod chat",
		});
		const msg = await thread.send("<@&490697044260945938>");
		await msg.delete();
		// await thread.members.add(interaction.user.id);
		await thread.send(
			`Hi <@${interaction.user.id}>, thanks for reaching out! This is a private chat between you and the mods. Please describe your issue here.`
		);

		await interaction.update({
			components: [{ type: ComponentType.ActionRow, components: [SelectMenu.toJSON()] }],
		});
	});
}
