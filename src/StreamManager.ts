import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type Client,
	type MessageActionRowComponentBuilder,
	MessageFlags,
	PermissionsBitField,
	SlashCommandBuilder,
	TextDisplayBuilder,
} from "discord.js";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

export const data = [
	new SlashCommandBuilder().setName("timer").setDescription("Manage stream timer").setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
];

type TimerModel = {
	channel: string;
	types: string[];
	display: "hidden" | "left" | "right";
	behavior: "stop" | "negative" | "positive";
	goal: string; // ISO date string
	maxGoal: string; // ISO date string
} & RecordModel;

const TIMER_ADJUSTMENTS: Record<string, number> = {
	stream_timer_add_10: 10,
	stream_timer_add_30: 30,
	stream_timer_subtract_1: -1,
	stream_timer_subtract_30: -30,
};

export default function StreamManager(client: Client, db: PocketBase) {
	client.on("interactionCreate", (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "timer") {
			interaction.reply({
				flags: MessageFlags.IsComponentsV2,
				components: [
					new TextDisplayBuilder().setContent("Timer adjustments"),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel("+ 10 mins").setCustomId("stream_timer_add_10"),
						new ButtonBuilder().setStyle(ButtonStyle.Success).setLabel("+ 30 mins").setCustomId("stream_timer_add_30"),
						new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel("- 1 min").setCustomId("stream_timer_subtract_1"),
						new ButtonBuilder().setStyle(ButtonStyle.Danger).setLabel("- 30 mins").setCustomId("stream_timer_subtract_30"),
					),
				],
			});
			return;
		}
	});

	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isButton()) return;
		const adjustment = TIMER_ADJUSTMENTS[interaction.customId];
		if (adjustment === undefined) return;
		if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
			interaction.reply({ content: "You don't have permission to use this button.", flags: MessageFlags.Ephemeral });
			return;
		}
		const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const timer = await db
			.collection("overlay_timers")
			.getFirstListItem<TimerModel>(`channel="msdvil"`)
			.catch(() => null);
		if (!timer) {
			interaction.editReply("No timer found for this channel.");
			return;
		}

		const now = new Date();

		// parse stored ISO strings into Date objects
		const currentGoal = new Date(timer.goal);
		const maxGoal = new Date(timer.maxGoal);

		let newGoal = new Date(currentGoal.getTime() + adjustment * 60 * 1000);

		let note = "";
		if (newGoal > maxGoal) {
			newGoal = maxGoal;
			note = " (capped to maximum allowed goal)";
		} else if (newGoal < now) {
			newGoal = now;
			note = " (cannot set goal before now)";
		}

		await db.collection("overlay_timers").update(timer.id, { goal: newGoal.toISOString() });

		await defer;
		await interaction.editReply(`Timer adjusted by **${adjustment} minutes**. New goal: <t:${Math.floor(newGoal.getTime() / 1000)}:R>${note}`);
	});
}
