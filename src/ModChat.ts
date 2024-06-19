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
			label: "Technical",
			value: "technical",
			description: "Critical bugs, account issues, etc.",
			emoji: "🔧",
		},
		{
			label: "Interpersonal",
			value: "social",
			description: "Negative interactions with other community members",
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

		await interaction.deferReply({ ephemeral: true });

		const option = interaction.values[0];
		const emoji = SelectMenu.options.find((o) => o.data.value === option)?.data.emoji;
		const thread = await interaction.channel.threads.create({
			type: ChannelType.PrivateThread,
			name: `${emoji?.name} ${client.users.cache.get(interaction.user.id)?.displayName}`,
			autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
			invitable: false,
			reason: "User requested mod chat",
		});
		const msg = await thread.send("<@&1253134360740102244>");
		await msg.delete();
		// await thread.members.add(interaction.user.id);
		await thread.send(
			`Hi <@${interaction.user.id}>, thanks for reaching out! This is a private chat between you and the mods. Please tell us what's on your mind.`
		);

		await interaction.message.edit({
			components: [{ type: ComponentType.ActionRow, components: [SelectMenu.toJSON()] }],
		});

		await interaction.editReply({
			content: `Your private chat has been created: <#${thread.id}>`,
		});
	});
}
