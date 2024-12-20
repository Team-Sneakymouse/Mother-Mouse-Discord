import { Client } from "discord.js";
import { Logger } from "winston";

export default function VCMonitor(client: Client, logger: Logger) {
	client.on("voiceStateUpdate", async (oldState, newState) => {
		if (newState.member!.user.bot) return;
		if (newState.guild.id !== "391355330241757205") return;

		const username = newState.member?.user.username || client.users.cache.get(newState.id)?.username || "Unknown";

		if (!oldState.channelId && !newState.channelId)
			logger.warn({
				message: `VoiceStateUpdate for ${username} with no channel`,
				labels: {
					userId: newState.id,
					oldState,
					newState,
				},
			}) && console.log("Error: No channel");
		else if (!oldState.channelId && newState.channelId)
			logger.info({
				message: `${username} joined channel ${newState.channel?.name}`,
				labels: {
					userId: newState.id,
					channelId: newState.channelId,
				},
			}) && console.log("User joined channel");
		else if (oldState.channelId && !newState.channelId)
			logger.info({
				message: `${username} left channel ${oldState.channel?.name}`,
				labels: {
					userId: newState.id,
					channelId: oldState.channelId,
				},
			}) && console.log("User left channel");
		else if (oldState.channelId !== newState.channelId)
			logger.info({
				message: `${username} moved channels from ${oldState.channel?.name} to ${newState.channel?.name}`,
				labels: {
					userId: newState.id,
					oldChannelId: oldState.channelId,
					channelId: newState.channelId,
				},
			}) && console.log("User moved channels");
	});
}
