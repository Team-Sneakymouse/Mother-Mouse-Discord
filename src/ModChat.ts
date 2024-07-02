import { ChannelType, Client, ComponentType, StringSelectMenuBuilder, TextBasedChannel, ThreadAutoArchiveDuration } from "discord.js";

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
			description: "Interactions with other community members",
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

		if (!interaction.channel.permissionsFor(interaction.user)?.has("UseApplicationCommands")) {
			await (client.channels.cache.get("1159792578619768882") as TextBasedChannel)?.send(
				`${interaction.user.username} (<@${interaction.user.id}>) tried to use the mod chat but doesn't have permissions.`
			);
			await new Promise((resolve) => setTimeout(resolve, 20000));
			await interaction.editReply({
				content: "Your session is temporarily unavailable. Please try again later.",
			});
			return;
		}

		const option = interaction.values[0];
		const emoji = SelectMenu.options.find((o) => o.data.value === option)?.data.emoji;
		const thread = await interaction.channel.threads.create({
			type: ChannelType.PrivateThread,
			name: `${emoji?.name} ${client.users.cache.get(interaction.user.id)?.displayName}`,
			autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
			invitable: false,
			reason: "User requested mod chat",
		});
		const msg = await thread.send(`<@&1253134360740102244> new mod chat for ${interaction.user.username}`);
		await msg.delete();
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
