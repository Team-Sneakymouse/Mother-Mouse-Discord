import { Redis } from "ioredis";
import { Client, Message, Snowflake, TextChannel, ComponentType, ButtonStyle, Collection, Interaction } from "discord.js";
import { ScheduleRepeating, RegisterOneTimeEvent, ScheduleOnce, SECS_IN_DAY, SECS_IN_WEEK, SECS_IN_HOUR } from "./utils/unixtime";

// const turtleFriendsId = "898925497508048896";// turtle friends discord id
const textChannelsToClear = [
	{
		channelId: "975496209882050640",
		frequency: SECS_IN_WEEK,
		clearEpoch: 1655568000,
	},
	{
		channelId: "980550809005736066",
		frequency: SECS_IN_WEEK,
		clearEpoch: 1655222400,
	},
	{
		channelId: "980550256116785252",
		frequency: SECS_IN_WEEK,
		clearEpoch: 1655395200,
	},
];
const percentageOfNoVotesNeededToNotClear = 0.75; //make sure all text matches this
const buttonIdYes = "ClearSupportChannel-yes-";
const buttonIdNo = "ClearSupportChannel-no-";
const redisVotingKey = "ClearSupportChannel-voting-";
const eventEndVotingKey = "ClearSupportChannel-endvote-";
const eventStartVotingKey = "ClearSupportChannel-";


async function ExecuteVote(redis: Redis, client: Client, channelId: string, scheduledTime: number) {
	const channel = await client.channels.fetch(channelId) as TextChannel;

	//if channel is empty skip deletion
	let temp_messages = (await channel.messages.fetch({ limit: 16 })).filter(
		(m) => !m.pinned && !m.system && !m.hasThread && m.deletable
	);
	if (temp_messages.size <= 0) return;


	await channel.send({
		content:
			"**It'll be time to clear this channel in 30 minutes.**\nYou may vote to postpone this until tomorrow if this is a problem, but the Postpone vote will need over 75%.",
		components: [
			{
				type: ComponentType.ActionRow,
				components: [
					{
						type: ComponentType.Button,
						label: "Clear it!",
						customId: buttonIdYes + channelId,
						style: ButtonStyle.Primary,
					},
					{
						type: ComponentType.Button,
						label: "Postpone",
						customId: buttonIdNo + channelId,
						style: ButtonStyle.Secondary,
					},
				],
			},
		],
	});

	ScheduleOnce(redis, eventEndVotingKey + channelId, scheduledTime + SECS_IN_HOUR / 2);
}

async function EndVote(redis: Redis, client: Client, channelId: string, scheduledTime: number) {
	const channel = await client.channels.fetch(channelId) as TextChannel;
	let key = redisVotingKey + channelId;

	//Voting is Closed
	let votingResults = await redis.hvals(key);
	let totalNoVotes = 0;
	let totalVotes = votingResults.length
	for (let isYes of votingResults) {
		totalNoVotes += isYes == "0" ? 1 : 0;
	}
	redis.del(key);

	if (totalNoVotes <= totalVotes * percentageOfNoVotesNeededToNotClear) {
		const deleteMessage = await channel.send(
			"The vote did not result in more than 75% in favor of postponing.\n**Clearing Channel - Please do not resist** <:DANGER:975520924512157717>"
		);
		channel.sendTyping();

		let isBulkFailed = false;
		let failures = 0;
		let attempts = 0;
		while (attempts < 1000 && failures < 8) {
			attempts += 1;
			//delete all channels
			let modernChannel = await client.channels.fetch(channelId) as TextChannel;
			let messages = (await modernChannel.messages.fetch({ limit: 100, before: deleteMessage.id })).filter(
				(m) => !m.pinned && !m.system && !m.hasThread && m.deletable
			);
			if (messages.size <= 0) break;

			console.log(`ClearSupportChannel: Deleting ${messages.size} messages`);

			if (!isBulkFailed) {
				let deleted = await modernChannel.bulkDelete(messages, true)
				.catch((reason) => {
					console.log(`ClearSupportChannel: Failed to bulkDelete ${messages.size} messages, ` + reason);
					failures += 1;
				});
				isBulkFailed = deleted ? deleted.size > 0 : false;
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
			if (isBulkFailed) {
				for (let [s, m] of messages) {
					let hasFailed = false;
					await m.delete().catch((reason) => {
						console.log(`ClearSupportChannel: Failed to delete ${messages.size} messages, ` + reason);
						failures += 1;
						hasFailed = true;
					});
					if (hasFailed) break;
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}
		}
		if (attempts < 1000 && failures < 8) {
			deleteMessage.edit("The channel has been cleared. Stay safe! <:bless:975520085919809587>");
		} else {
			deleteMessage.edit("I cannot delete the last few messages in this channel. Discord makes me sad :(. <:bless:975520085919809587>");
		}
	} else {
		channel.send("The channel has been spared. Stay safe! <:bless:975520085919809587>");

		ScheduleOnce(redis, eventStartVotingKey + channelId, scheduledTime + SECS_IN_DAY);
	}
}

export default function ClearSupportChannel(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction: Interaction) => {
		//Monitor Voting
		if (interaction.isButton()) {
			let key: string | null = null;
			let isYes: string = "0";
			if (interaction.customId.startsWith(buttonIdYes)) {
				let channelId = interaction.customId.substring(buttonIdYes.length);
				key = redisVotingKey + channelId;
				isYes = "1";
			} else if (interaction.customId.startsWith(buttonIdNo)) {
				let channelId = interaction.customId.substring(buttonIdNo.length);
				key = redisVotingKey + channelId;
			}

			if (key) {
				let curIsYes = await redis.hget(key, interaction.user.id);
				if (curIsYes == null) {
					redis.hset(key, interaction.user.id, isYes);
					interaction.reply({
						content: "Your vote has been counted",
						ephemeral: true,
					});
				} else if (curIsYes == isYes) {
					interaction.reply({
						content: "You have already voted for this",
						ephemeral: true,
					});
				} else {
					redis.hset(key, interaction.user.id, isYes);
					interaction.reply({
						content: `Your vote has been changed to ${isYes === "1" ? '"Clear"' : '"Postpone"'}`,
						ephemeral: true,
					});
				}
			}
		}
	});

	//register events
	for (let { channelId, frequency, clearEpoch } of textChannelsToClear) {
		let exec = (scheduledTime: number) => {
			ExecuteVote(redis, client, channelId, scheduledTime);
		};

		ScheduleRepeating(redis,
			eventStartVotingKey + channelId,
			clearEpoch,
			frequency,
			exec,
		);
		RegisterOneTimeEvent(redis, eventStartVotingKey + channelId, exec);
		RegisterOneTimeEvent(redis, eventEndVotingKey + channelId, (scheduledTime: number) => {
			EndVote(redis, client, channelId, scheduledTime);
		});
	}
}
