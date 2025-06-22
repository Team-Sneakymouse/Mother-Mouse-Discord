import { CronJob } from "cron";
import PocketBase, { RecordModel } from "pocketbase";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelSelectMenuBuilder,
	ChannelType,
	Client,
	ContainerBuilder,
	Guild,
	GuildTextBasedChannel,
	MessageActionRowComponentBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	TextChannel,
	TextDisplayBuilder,
} from "discord.js";

export const data = [
	new SlashCommandBuilder()
		.setName("channelclearvoting")
		.setDescription("Set up channel clear voting")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages),
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export default function ChannelClearVoting(client: Client, pb: PocketBase) {
	let running = false;
	const cronJob = new CronJob("0 */2 * * * *", async () => {
		if (running) return;
		running = true;
		try {
			const targetRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
				filter: `next_run != "" && next_run <= "${new Date().toISOString()}" && enabled = true`,
			});
			if (targetRecords.length === 0) {
				console.log("No channel clear voting records to process");
				return;
			}
			console.log(`Processing ${targetRecords.length} channel clear voting records`);
			for (let record of targetRecords) {
				await workRecord(record);
			}
		} catch (err) {
			console.error("Failed to do work", err);
		} finally {
			running = false;
		}
	});

	async function workRecord(record: ChannelClearVotingRecord) {
		if (!configurationIsValid(record)) {
			console.log(`Skipping channel ${record.id} in server ${record.server_id} due to invalid configuration`);
			return;
		}
		const channel = client.channels.cache.get(record.id) as TextChannel | undefined;
		const permissions = channel?.guild.members.me?.permissionsIn(channel.id);
		if (
			!channel ||
			!permissions ||
			!permissions.has(PermissionFlagsBits.ViewChannel) ||
			!permissions.has(PermissionFlagsBits.SendMessages)
		) {
			console.log(`Channel ${record.id} not found or missing permissions in server ${record.server_id}`);
			record.enabled = false; // Disable the voting configuration
			record.votes = null; // Reset votes
			record.next_run = null; // Clear next_run
			record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", record);
			return;
		}

		if (record.votes == null) {
			// Start the voting
			console.log(`Starting voting for channel ${record.id} in server ${record.server_id}`);
			record.votes = {};
			record = await scheduleNext(record);

			console.log(record);

			const voteEnd = new Date(record.next_run ?? "");
			const voteRetry = new Date(voteEnd.getTime() + (record.retry_delay > 0 ? record.retry_delay : record.schedule));
			channel.send({
				content: `**It'll be time to clear this channel in ${millisToString(
					record.duration
				)}.**\nYou may vote to postpone this until <t:${Math.floor(
					voteRetry.getTime() / 1000
				)}:R> if this is a problem.\n-# The channel will be cleared unless there are ${record.vote_target}% ${
					record.vote_target < 100 ? "or more" : ""
				} "Postpone" votes.`,
				components: [
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder().setLabel("Clear it!").setCustomId(`ccv_vote_clear:${record.id}`).setStyle(ButtonStyle.Primary),
						new ButtonBuilder()
							.setLabel("Postpone")
							.setCustomId(`ccv_vote_postpone:${record.id}`)
							.setStyle(ButtonStyle.Secondary)
					),
				],
			});
		} else {
			// End the voting
			console.log(`Ending voting for channel ${record.id} in server ${record.server_id}`);
			if (!channel) {
				console.log(`Channel ${record.id} not found in server ${record.server_id}`);
				return;
			}

			let totalVotes = Object.keys(record.votes).length;
			let totalPostponeVotes = Object.values(record.votes).filter((vote) => vote).length;

			if (totalVotes > 0 && totalPostponeVotes * 100 >= totalVotes * record.vote_target) {
				// Enough votes to postpone
				record.votes = null; // Reset votes
				record = await scheduleNext(record, record.retry_delay);

				console.log(`Postponing channel clearing for ${record.id} in server ${record.server_id}`);
				await channel.send({
					content: `The vote to clear this channel has been postponed until <t:${Math.floor(
						new Date(record.next_run ?? "").getTime() / 1000
					)}:R>.`,
				});
				return;
			}

			// Not enough votes to postpone, clear the channel
			const permissions = channel.guild.members.me?.permissionsIn(channel.id);
			if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages)) {
				await channel.send({
					content: "I need the `Manage Messages` permission to clear this channel.",
				});
				record.votes = null; // Reset votes
				record.enabled = false; // Disable the voting configuration
				record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", record);
				return;
			}
			console.log(`Clearing channel ${channel.id} in server ${channel.guildId}`);
			const deleteMessage = await channel.send(
				`The vote did not result in ${
					record.vote_target < 100 ? `at least ${record.vote_target}%` : "unanimity"
				} in favor of postponing.\n**Clearing Channel - Please do not resist** <:DANGER:975520924512157717>`
			);
			await clearChannel(channel, deleteMessage.id);

			await deleteMessage.edit({
				content: "The channel has been cleared. Stay safe! <:bless:975520085919809587>",
				components: [],
			});

			record.votes = null; // Reset votes
			record = await scheduleNext(record);
		}
	}

	async function clearChannel(channel: GuildTextBasedChannel, beforeMessageId?: string) {
		while (true) {
			const messages = (await channel.messages.fetch({ limit: 100, before: beforeMessageId })).filter(
				(m) => !m.pinned && !m.system && !m.hasThread && m.deletable
			);
			if (messages.size <= 0) break; // No more messages to delete

			console.log(`Clearing channel ${channel.id}: Deleting ${messages.size} messages`);
			const [youngMessages, oldMessages] = messages.partition((m) => m.createdAt.getTime() >= Date.now() - 14 * DAY);
			if (oldMessages.size > 25) await channel.sendTyping();
			if (youngMessages.size > 0) {
				// Bulk delete messages newer than 14 days old
				try {
					await channel.bulkDelete(youngMessages, true);
				} catch (error) {
					console.error(`Failed to bulk delete messages in channel ${channel.id}:`, error);
				}
			}
			// normal delete for remaining messages
			for (const message of oldMessages.values()) {
				try {
					await message.delete();
				} catch (error) {
					console.error(`Failed to delete message ${message.id} in channel ${channel.id}:`, error);
				}
			}
		}
	}

	async function scheduleNext(record: ChannelClearVotingRecord, retryDelay?: number) {
		if (!record.enabled || !configurationIsValid(record)) {
			console.log(`Skipping scheduling for channel ${record.id} in server ${record.server_id} due to invalid configuration`);
			return record;
		}

		const delay =
			retryDelay ?? record.votes == null
				? record.schedule // Next run is for the vote start
				: record.duration; // Next run is for the vote end

		const nextRun = new Date();
		nextRun.setSeconds(0);
		nextRun.setMilliseconds(0);
		nextRun.setTime(nextRun.getTime() + delay);
		record.next_run = nextRun.toISOString();
		record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", record);
		console.log(`Scheduled next vote start for channel ${record.id} in server ${record.server_id} at ${nextRun.toISOString()}`);
		return record;
	}

	client.on("ready", () => {
		cronJob.start();
		cronJob.fireOnTick();
		console.log("ChannelClearVoting job started");
	});

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "channelclearvoting") {
			if (!interaction.guild) {
				await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
				return;
			}
			const channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
				filter: `server_id = "${interaction.guildId}"`,
			});
			const components = buildInterface(interaction.guild, channelRecords, interaction.channelId);
			await interaction.reply({
				flags: MessageFlags.IsComponentsV2,
				components,
				ephemeral: true,
			});
		} else if (interaction.isButton() && ["ccv_vote_postpone", "ccv_vote_clear"].some((id) => interaction.customId.startsWith(id))) {
			if (!interaction.guild) {
				await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
				return;
			}

			const [command, channelId] = interaction.customId.split(":");
			console.log("ChannelClearVoting interaction", command, channelId);
			const record = await pb.collection("mmd_channel_clear_voting").getOne<ChannelClearVotingRecord>(channelId);
			if (!record || !configurationIsValid(record)) {
				await interaction.reply({ content: "No valid voting configuration found for this channel.", ephemeral: true });
				return;
			}
			if (record.votes == null) {
				await interaction.reply({ content: "No voting is currently active for this channel.", ephemeral: true });
				return;
			}

			const existingVote = interaction.user.id in record.votes;
			if (command === "ccv_vote_postpone") {
				record.votes[interaction.user.id] = true; // Mark as "Postpone" vote
			} else if (command === "ccv_vote_clear") {
				record.votes[interaction.user.id] = false; // Mark as "Clear" vote
			}

			await pb.collection("mmd_channel_clear_voting").update(channelId, {
				votes: record.votes,
			});

			await interaction.reply({
				content: `Your vote has been ${existingVote ? "updated" : "counted"}.`,
				ephemeral: true,
			});
		} else if (
			interaction.isButton() &&
			["ccv_delete_configuration", "ccv_enable_configuration", "ccv_disable_configuration"].some((id) =>
				interaction.customId.startsWith(id)
			)
		) {
			if (!interaction.guild) {
				await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
				return;
			}

			let [command, channelId]: [string, string | null] = interaction.customId.split(":") as [string, string];
			console.log("ChannelClearVoting interaction", command, channelId);
			let channelRecords: ChannelClearVotingRecord[];
			switch (command) {
				case "ccv_delete_configuration":
					await pb.collection("mmd_channel_clear_voting").delete(channelId);
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					channelId = null; // Reset selected channel after deletion
					break;
				case "ccv_enable_configuration":
					const botPermissions = interaction.guild.members.me?.permissionsIn(channelId);
					if (!botPermissions || !botPermissions.has(PermissionFlagsBits.ViewChannel)) {
						await interaction.reply({
							content: `I need the \`View Channel\` permission in <#${channelId}> to enable channel clear voting.`,
							ephemeral: true,
						});
						return;
					} else if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
						await interaction.reply({
							content: `I need the \`Send Messages\` permission in <#${channelId}> to enable channel clear voting.`,
							ephemeral: true,
						});
						return;
					} else if (!botPermissions.has(PermissionFlagsBits.ManageMessages)) {
						await interaction.reply({
							content: `I need the \`Manage Messages\` permission in <#${channelId}> to enable channel clear voting.`,
							ephemeral: true,
						});
						return;
					}
					const record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						enabled: true,
					});
					await scheduleNext(record);
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				case "ccv_disable_configuration":
					await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						enabled: false,
						next_run: null, // Clear next_run when disabling
					});
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				default: {
					await interaction.reply({ content: "Unknown button: `" + command + "`", ephemeral: true });
					return;
				}
			}
			await interaction.update({
				components: buildInterface(interaction.guild, channelRecords, channelId),
			});
		} else if (interaction.isAnySelectMenu() && interaction.customId.startsWith("ccv_")) {
			if (!interaction.guild) {
				await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
				return;
			}

			let [command, channelId]: [string, string | null] = interaction.customId.split(":") as [string, string];
			console.log("ChannelClearVoting interaction", command, channelId, interaction.values);
			let channelRecords: ChannelClearVotingRecord[];
			switch (command) {
				case "ccv_channel_select": {
					channelId = interaction.values[0];
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				}
				case "ccv_schedule_select": {
					const schedule = parseInt(interaction.values[0]);
					const record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						schedule,
					});
					if (record.enabled && record.votes == null) await scheduleNext(record);
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				}
				case "ccv_duration_select": {
					const duration = parseInt(interaction.values[0]);
					const record = await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						duration,
					});
					if (record.enabled && record.votes != null) await scheduleNext(record);
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				}
				case "ccv_vote_target_select": {
					const voteTarget = parseFloat(interaction.values[0]);
					await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						vote_target: voteTarget,
					});
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				}
				case "ccv_retry_delay_select": {
					const retryDelay = parseInt(interaction.values[0]);
					await pbUpsert<ChannelClearVotingRecord>(pb, "mmd_channel_clear_voting", {
						id: channelId,
						server_id: interaction.guildId,
						retry_delay: retryDelay,
					});
					channelRecords = await pb.collection("mmd_channel_clear_voting").getFullList<ChannelClearVotingRecord>(200, {
						filter: `server_id = "${interaction.guildId}"`,
					});
					break;
				}
				default: {
					await interaction.reply({ content: "Unknown command: `" + command + "`", ephemeral: true });
					return;
				}
			}
			await interaction.update({
				components: buildInterface(interaction.guild, channelRecords, channelId),
			});
		} else {
			console.error("Unknown interaction", interaction);
		}
	});

	function buildInterface(guild: Guild, channelRecords: ChannelClearVotingRecord[], selected: string | null = null) {
		const guildTextChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText);
		if (!guildTextChannels) return [new TextDisplayBuilder().setContent("No text channels found in this server.")];

		const selectedChannelRecord = channelRecords.find((record) => record.id === selected) ?? {
			id: selected ?? "",
			collectionId: "",
			collectionName: "",
			server_id: guild.id,
			enabled: false,
			next_run: null,
			votes: {} satisfies Record<string, boolean>,
			schedule: 0,
			duration: 0,
			vote_target: -1,
			retry_delay: 0,
		};
		return [
			new TextDisplayBuilder().setContent("# Channel Clear Voting"),
			new TextDisplayBuilder().setContent(
				`${
					channelRecords.length == 0 ? "No" : channelRecords.length
				} channels are currently set up for clear voting. Use the dropdown to select a channel and manage its voting settings.${channelRecords
					.map(
						(record) =>
							`\n- ${record.enabled ? "✅" : "⭕"} <#${record.id}> ${
								record.next_run
									? `scheduled <t:${Math.floor(new Date(selectedChannelRecord.next_run ?? "").getTime() / 1000)}:R>`
									: "not scheduled"
							}`
					)
					.join("")}`
			),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				guildTextChannels.size <= 25
					? new StringSelectMenuBuilder()
							.setCustomId("ccv_channel_select")
							.setPlaceholder("Select a channel to manage voting settings")
							.addOptions(
								Array.from(guildTextChannels.values()).map((channel) => ({
									value: channel.id,
									default: selected === channel.id,
									label: "#" + channel.name,
									description: channelRecords.find((record) => record.id === channel.id)
										? channelRecords.find((record) => record.id === channel.id)?.enabled
											? "✅ Voting enabled"
											: "⭕ Voting disabled"
										: "No configuration",
								}))
							)
					: // If there are more than 25 channels, use a channel select menu
					  new ChannelSelectMenuBuilder()
							.setCustomId("ccv_channel_select")
							.setChannelTypes(ChannelType.GuildText)
							.setPlaceholder("Select a channel to manage voting settings")
							.addDefaultChannels(selected ? [selected] : [])
			),
			...(selected == null
				? []
				: [
						new ContainerBuilder()
							.addSectionComponents(
								new SectionBuilder()
									.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <#${selectedChannelRecord.id}>`))
									.setButtonAccessory(
										new ButtonBuilder()
											.setCustomId(`ccv_delete_configuration:${selectedChannelRecord.id}`)
											.setStyle(ButtonStyle.Danger)
											.setLabel("Delete Configuration")
											.setEmoji({ name: "🗑️" })
											.setDisabled(channelRecords.some((record) => record.id === selectedChannelRecord.id) === false)
									)
							)
							.addSectionComponents(
								new SectionBuilder()
									.addTextDisplayComponents(
										new TextDisplayBuilder().setContent(
											`This configuration is currently **${
												!configurationIsValid(selectedChannelRecord)
													? "incomplete"
													: selectedChannelRecord.enabled
													? "enabled"
													: "disabled"
											}**.${
												configurationIsValid(selectedChannelRecord) &&
												selectedChannelRecord.enabled &&
												selectedChannelRecord.next_run
													? `\nNext vote will run <t:${Math.floor(
															new Date(selectedChannelRecord.next_run ?? "").getTime() / 1000
													  )}:R>.`
													: ""
											}`
										)
									)
									.setButtonAccessory(
										new ButtonBuilder()
											.setCustomId(
												`${
													selectedChannelRecord.enabled ? "ccv_disable_configuration" : "ccv_enable_configuration"
												}:${selectedChannelRecord.id}`
											)
											.setStyle(selectedChannelRecord.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
											.setLabel(selectedChannelRecord.enabled ? "Disable Voting" : "Enable Voting")
											.setEmoji({ name: selectedChannelRecord.enabled ? "❌" : "✅" })
											.setDisabled(configurationIsValid(selectedChannelRecord) === false)
									)
							)
							.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
							.addTextDisplayComponents(new TextDisplayBuilder().setContent("When should a vote happen?"))
							.addActionRowComponents(
								new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
									new StringSelectMenuBuilder()
										.setCustomId(`ccv_schedule_select:${selectedChannelRecord.id}`)
										.setPlaceholder("Select the schedule for voting")
										.addOptions(
											new StringSelectMenuOptionBuilder()
												.setLabel("Every Day")
												.setValue((1 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 1 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 2 Days")
												.setValue((2 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 2 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 4 Days")
												.setValue((4 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 4 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 7 Days")
												.setValue((7 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 7 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 14 Days")
												.setValue((14 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 14 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 28 Days")
												.setValue((28 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 28 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("Every 30 Days")
												.setValue((30 * DAY).toString())
												.setDefault(selectedChannelRecord.schedule === 30 * DAY)
										)
								)
							)
							.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
							.addTextDisplayComponents(new TextDisplayBuilder().setContent("How long should the vote collect responses?"))
							.addActionRowComponents(
								new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
									new StringSelectMenuBuilder()
										.setCustomId(`ccv_duration_select:${selectedChannelRecord.id}`)
										.setPlaceholder("Select the vote duration")
										.addOptions(
											new StringSelectMenuOptionBuilder()
												.setLabel("10 Minutes")
												.setValue((10 * MINUTE).toString())
												.setDefault(selectedChannelRecord.duration === 10 * MINUTE),
											new StringSelectMenuOptionBuilder()
												.setLabel("15 Minutes")
												.setValue((15 * MINUTE).toString())
												.setDefault(selectedChannelRecord.duration === 15 * MINUTE),
											new StringSelectMenuOptionBuilder()
												.setLabel("30 Minutes")
												.setValue((30 * MINUTE).toString())
												.setDefault(selectedChannelRecord.duration === 30 * MINUTE),
											new StringSelectMenuOptionBuilder()
												.setLabel("60 Minutes")
												.setValue((1 * HOUR).toString())
												.setDefault(selectedChannelRecord.duration === 1 * HOUR),
											new StringSelectMenuOptionBuilder()
												.setLabel("120 Minutes")
												.setValue((2 * HOUR).toString())
												.setDefault(selectedChannelRecord.duration === 2 * HOUR)
										)
								)
							)
							.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
							.addTextDisplayComponents(
								new TextDisplayBuilder().setContent(
									'How many "Postpone"-votes should be required to postpone the channel clearing?'
								)
							)
							.addActionRowComponents(
								new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
									new StringSelectMenuBuilder()
										.setCustomId(`ccv_vote_target_select:${selectedChannelRecord.id}`)
										.setPlaceholder("Select the vote target percentage")
										.addOptions(
											new StringSelectMenuOptionBuilder()
												.setLabel("10%")
												.setValue("10")
												.setDescription("or higher")
												.setDefault(selectedChannelRecord.vote_target === 10),
											new StringSelectMenuOptionBuilder()
												.setLabel("25%")
												.setValue("25")
												.setDescription("or higher")
												.setDefault(selectedChannelRecord.vote_target === 25),
											new StringSelectMenuOptionBuilder()
												.setLabel("50%")
												.setValue("50")
												.setDescription("or higher")
												.setDefault(selectedChannelRecord.vote_target === 50),
											new StringSelectMenuOptionBuilder()
												.setLabel("75%")
												.setValue("75")
												.setDescription("or higher")
												.setDefault(selectedChannelRecord.vote_target === 75),
											new StringSelectMenuOptionBuilder()
												.setLabel("90%")
												.setValue("90")
												.setDescription("or higher")
												.setDefault(selectedChannelRecord.vote_target === 90),
											new StringSelectMenuOptionBuilder()
												.setLabel("100%")
												.setValue("100")
												.setDescription("Only postpone on unanimity")
												.setDefault(selectedChannelRecord.vote_target === 100)
										)
								)
							)
							.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
							.addTextDisplayComponents(
								new TextDisplayBuilder().setContent(
									"If the results in postponing, after what delay should the vote be retried?"
								)
							)
							.addActionRowComponents(
								new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
									new StringSelectMenuBuilder()
										.setCustomId(`ccv_retry_delay_select:${selectedChannelRecord.id}`)
										.setPlaceholder("Select the retry delay")
										.addOptions(
											new StringSelectMenuOptionBuilder()
												.setLabel("No Retry")
												.setDescription("Just wait for the next scheduled vote")
												.setValue("0")
												.setDefault(selectedChannelRecord.retry_delay === 0),
											new StringSelectMenuOptionBuilder()
												.setLabel("60 Minutes")
												.setValue((60 * MINUTE).toString())
												.setDefault(selectedChannelRecord.retry_delay === 60 * MINUTE),
											new StringSelectMenuOptionBuilder()
												.setLabel("2 Hours")
												.setValue((2 * HOUR).toString())
												.setDefault(selectedChannelRecord.retry_delay === 2 * HOUR),
											new StringSelectMenuOptionBuilder()
												.setLabel("6 Hours")
												.setValue((6 * HOUR).toString())
												.setDefault(selectedChannelRecord.retry_delay === 6 * HOUR),
											new StringSelectMenuOptionBuilder()
												.setLabel("12 Hours")
												.setValue((12 * HOUR).toString())
												.setDefault(selectedChannelRecord.retry_delay === 12 * HOUR),
											new StringSelectMenuOptionBuilder()
												.setLabel("1 Day")
												.setValue((1 * DAY).toString())
												.setDefault(selectedChannelRecord.retry_delay === 1 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("2 Days")
												.setValue((2 * DAY).toString())
												.setDefault(selectedChannelRecord.retry_delay === 2 * DAY),
											new StringSelectMenuOptionBuilder()
												.setLabel("7 Days")
												.setValue((7 * DAY).toString())
												.setDefault(selectedChannelRecord.retry_delay === 7 * DAY)
										)
								)
							),
				  ]),
		];
	}
}

function configurationIsValid(record: ChannelClearVotingRecord) {
	return record.schedule > 0 && record.duration > 0 && record.vote_target > 0 && record.vote_target <= 100 && record.retry_delay >= 0;
}

function millisToString(milliseconds: number) {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	let result = [];
	if (days > 0) result.push(`${days} day${days > 1 ? "s" : ""}`);
	if (hours % 24 > 0) result.push(`${hours % 24} hour${hours % 24 > 1 ? "s" : ""}`);
	if (minutes % 60 > 0) result.push(`${minutes % 60} minute${minutes % 60 > 1 ? "s" : ""}`);
	if (seconds % 60 > 0 || result.length === 0) result.push(`${seconds % 60} second${seconds % 60 > 1 ? "s" : ""}`);
	return result.join(", ");
}

async function pbUpsert<T>(pb: PocketBase, collection: string, record: { id: string } & Record<string, any>) {
	// This function will either create a new record or update an existing one in PocketBase
	try {
		return await pb.collection(collection).update<T>(record.id, record);
	} catch (error) {
		if ((error as any).status === 404) {
			return await pb.collection(collection).create<T>(record);
		}
		throw error; // Re-throw if it's not a 404 error
	}
}

type ChannelClearVotingRecord = RecordModel & {
	server_id: string;
	enabled: boolean;
	next_run: string | null; // ISO 8601 string or null if not set
	votes: Record<string, boolean> | null; // null if no votes are currently being collected
	schedule: number; // milliseconds between votes
	duration: number; // duration of vote collection in milliseconds
	vote_target: number; // percentage of votes needed to clear the channel (0-1)
	retry_delay: number; // milliseconds to wait before retrying if not enough votes
};
