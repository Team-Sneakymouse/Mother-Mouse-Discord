import { ApplicationCommandType, Client, ContextMenuCommandBuilder } from "discord.js";

const type: number = ApplicationCommandType.Message;
export const data = [new ContextMenuCommandBuilder().setType(type).setName("Translate Twitter Link")];

export default function ThreadPins(client: Client) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isMessageContextMenuCommand()) return;
		if (interaction.commandName !== "Translate Twitter Link") return;

		const content = interaction.targetMessage.content;
		const links = [...content.matchAll(/https:\/\/(?:twitter.com|x.com)\/\w+\/status\/\d+/g)].map((s) => s[0]);
		if (links.length === 0) {
			await interaction.reply({
				content: "This message doesn't contain a Twitter link.",
				ephemeral: true,
			});
			return;
		}

		await interaction.reply({
			content: links.map((l) => l.replace(/(?:twitter.com|x.com)/, "vxtwitter.com")).join("\n"),
			ephemeral: true,
		});
	});
}
