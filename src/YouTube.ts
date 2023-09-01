import { Client, ComponentType, ModalBuilder, SlashCommandBuilder, SlashCommandStringOption, TextInputStyle } from "discord.js";
import type YouTubeDL from "./utils/youtube-dl.js";

export const data = [
	new SlashCommandBuilder()
		.setName("youtube-dl")
		.setDescription("Download internet videos")
		.addStringOption(new SlashCommandStringOption().setName("url").setDescription("url of video to download").setRequired(false)),
];

export default function YouTube(client: Client, ytdl: YouTubeDL) {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isCommand() || interaction.commandName !== "youtube-dl") return;
		let url = interaction.options.get("url")?.value as string | undefined;
		await interaction.showModal(
			new ModalBuilder({
				title: "YouTube-DL",
				custom_id: "youtube-dl",
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								custom_id: "youtube-dl-url",
								type: ComponentType.TextInput,
								style: TextInputStyle.Short,
								label: "URL",
								value: url,
								required: true,
							},
						],
					},
					{
						type: ComponentType.ActionRow,
						components: [
							{
								custom_id: "youtube-dl-speed",
								type: ComponentType.TextInput,
								style: TextInputStyle.Short,
								label: "Speed",
								value: "1",
								required: false,
							},
						],
					},
					{
						type: ComponentType.ActionRow,
						components: [
							{
								custom_id: "youtube-dl-pitch",
								type: ComponentType.TextInput,
								style: TextInputStyle.Short,
								label: "Pitch (leave empty to scale with speed)",
								value: "",
								required: false,
							},
						],
					},
				],
			})
		);
		const modal = await interaction
			.awaitModalSubmit({
				filter: (i) => i.customId === "youtube-dl",
				time: 60000,
			})
			.catch(() => null);

		if (!modal) {
			await interaction.editReply("Timed out");
			return;
		}

		url = modal.fields.getTextInputValue("youtube-dl-url");
		const speed = modal.fields.getTextInputValue("youtube-dl-speed") || "1";
		const pitch = modal.fields.getTextInputValue("youtube-dl-pitch") || speed;

		if (!url) {
			await modal.reply("No url provided");
			return;
		}

		await modal.reply("Downloading <a:typing:990723371522195526>");
		try {
			let file = await ytdl.download(url, (progress, eta) => {
				let bar = new Array(22)
					.fill(0)
					.map((_, i) => (i <= (progress * 22) / 100 ? "=" : " "))
					.join("");
				bar = "`[" + bar + "]`";
				modal.editReply(`Downloading <a:typing:990723371522195526>\n${bar} ${progress.toFixed(1)}%, ETA ${eta}`);
			});
			file = await ytdl.resample(file, speed, pitch, (progress, eta) => {
				let bar = new Array(22)
					.fill(0)
					.map((_, i) => (i <= (progress * 22) / 100 ? "=" : " "))
					.join("");
				bar = "`[" + bar + "]`";
				modal.editReply(`Resampling <a:typing:990723371522195526>\n${bar} ${progress.toFixed(1)}%, ETA ${eta}`);
			});
			// console.log(file);
			await modal.editReply("Uploading to Discord <a:typing:990723371522195526>");
			await modal.editReply({
				content: "Done!",
				files: [file],
			});
		} catch (e) {
			await modal.editReply("Error: " + (typeof e === "string" ? e : "\n```json\n" + JSON.stringify(e, null, 2) + "\n```"));
		}
	});
	client.on("messageCreate", async (message) => {
		if (message.channelId !== "990732990365720647") return;
		if (message.author.id === client.user!.id) return;

		const urls = message.content
			.split(/[\t\n\s]/)
			.map((u) => {
				try {
					return new URL(u);
				} catch (_) {
					return null;
				}
			})
			.filter((u) => !!u) as URL[];

		if (urls.length === 0) return;

		const reply = await message.reply("Getting info <a:typing:990723371522195526>");
		try {
			const progressUpdates = urls.map((_) => "waiting for start... 0%, ETA n/a");
			let lastUpdate = Date.now();
			function updateProgress() {
				if (Date.now() - lastUpdate < 2000) return;
				reply.edit(`Downloading <a:typing:990723371522195526>\n${progressUpdates.join("\n")}`);
				lastUpdate = Date.now();
			}
			const files = await Promise.all(
				urls.map((url, index) =>
					ytdl.download(url.href, (progress, eta) => {
						let bar = new Array(22)
							.fill(0)
							.map((_, i) => (i <= (progress * 22) / 100 ? "=" : " "))
							.join("");
						bar = "`[" + bar + "]`";
						progressUpdates[index] = `${bar} ${progress.toFixed(1)}%, ETA ${eta}`;
						updateProgress();
					})
				)
			);
			// console.log(file);
			await reply.edit("Uploading to Discord <a:typing:990723371522195526>");
			await reply.edit({
				content: "Done!",
				files,
			});
		} catch (e) {
			reply.edit("Error: " + (typeof e === "string" ? e : "\n```json\n" + JSON.stringify(e, null, 2) + "\n```"));
		}
	});
}
