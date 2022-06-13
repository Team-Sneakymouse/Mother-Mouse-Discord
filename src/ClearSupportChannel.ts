import { Console } from "console";
import { Client, Message, Snowflake, TextChannel, ComponentType, ButtonStyle, Collection, Interaction } from "discord.js";
import { Redis } from "ioredis";
import { ScheduleRepeating, SECS_IN_WEEK } from "./utils/unixtime";

var changeTimeout: NodeJS.Timeout;
var isTimedOut = false;


var clearMessage: Message;


const turtleFriendsId = "898925497508048896";// turtle friends discord id
const textChannelsToClear = [
	{
		channelId: "975496209882050640",
		frequency: SECS_IN_WEEK,
		clearEpoch: 0,
	},
];
const percentageOfNoVotesNeededToNotClear = .75;//make sure all text matches this
const buttonIdYes = "ClearSupportChannel-yes-";
const buttonIdNo = "ClearSupportChannel-no-";


var voteData: Map<string, Map<Snowflake, boolean>> = new Map();

async function ExecuteVote(channelId: string, channel: TextChannel) {
	clearMessage = await channel.send({
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
	let votes: Map<Snowflake, boolean> = new Map();
	voteData.set(channelId, votes);

	await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 30));//TODO(mami): make this failsafe if mother mouse goes down in this time

	//Voting is Closed

	let totalVotes = votes.size;
	let totalNoVotes = 0;
	for (let [userId, isYes] of votes) {
		totalNoVotes += isYes ? 0 : 1;
	}
	voteData.delete(channelId);

	if (totalNoVotes < totalVotes * percentageOfNoVotesNeededToNotClear) {
		const deleteMessage = await channel.send(
			"The vote did not result in more than 75% in favor of postponing.\n**Clearing Channel - Please do not resist** <:DANGER:975520924512157717>"
		);
		channel.sendTyping();
		var messages: Collection<string, Message>;
		do {//delete all channels
			messages = (await channel.messages.fetch({ limit: 100, before: deleteMessage.id })).filter(
				(m) => !m.pinned && !m.system && !m.hasThread
			);
			console.log(`ClearSupportChannel: Deleting ${messages.size} messages`);

			await channel.bulkDelete(
				messages,
				true
			);

			await new Promise((resolve) => setTimeout(resolve, 2000));

		} while (messages.size > 0);
		await deleteMessage.edit("The channel has been cleared. Stay safe! <:bless:975520085919809587>");
	}
};

export default function ClearSupportChannel(client: Client, redis: Redis) {
	client.on("interactionCreate", async (interaction: Interaction) => {//Monitor Voting
		if (interaction.isButton()) {
			let votes = undefined;
			let isYes = false;
			if (interaction.customId.startsWith(buttonIdYes)) {
				let channelId = interaction.customId.substring(buttonIdYes.length);
				votes = voteData.get(channelId);
				isYes = true;
			} else if (interaction.customId.startsWith(buttonIdNo)) {
				let channelId = interaction.customId.substring(buttonIdNo.length);
				votes = voteData.get(channelId);
				isYes = false;
			}

			if (votes) {
				let curIsYes = votes.get(interaction.user.id);
				if (curIsYes == undefined) {
					votes.set(interaction.user.id, isYes);
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
					votes.set(interaction.user.id, isYes);
					interaction.reply({
						content: `Your vote has been changed to ${isYes ? '"Clear"' : '"Postpone"'}`,
						ephemeral: true,
					});
				}
			}
		}
	});

	for (let { channelId, frequency, clearEpoch } of textChannelsToClear) {
		const channel = client.channels.cache.get(channelId) as TextChannel;
		if (channel) {
			ScheduleRepeating(redis, "ClearSupportChannel-" + channelId, clearEpoch, frequency, () => {
				ExecuteVote(channelId, channel);
			});
		} else {
			console.log("ClearSupportChannel: could not find channel " + channelId);
		}
	}

}
