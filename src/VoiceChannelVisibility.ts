import { Client, TextChannel, VoiceChannel } from "discord.js";

const stageChannel = "827955182460993537";
const voiceChannel = "835258562090762280";
const textChannel = "827959706240024646";

const buildThread = "1104820787480887396";
const buildVc = "1104820974970478663";

function channelJoin(oldId: String | null, newId: String | null) {
	return (oldId !== stageChannel && newId === stageChannel) || (oldId !== voiceChannel && newId === voiceChannel);
}

function channelLeave(oldId: String | null, newId: String | null) {
	return (oldId === stageChannel && newId !== stageChannel) || (oldId === voiceChannel && newId !== voiceChannel);
}

export default function StageChatChannel(client: Client) {
	client.on("voiceStateUpdate", async (oldState, newState) => {
		if (newState.member!.user.bot) return;

		if (channelJoin(oldState.channelId, newState.channelId)) {
			const chatChannel = client.channels.cache.get(textChannel) as TextChannel;
			console.log(`${newState.member!.displayName} has joined the stage!`);
			await chatChannel.permissionOverwrites.create(newState.member!.id, {
				ViewChannel: true,
			});
		} else if (channelLeave(oldState.channelId, newState.channelId)) {
			const chatChannel = client.channels.cache.get(textChannel) as TextChannel;
			console.log(`${oldState.member!.displayName} has left the stage!`);
			await chatChannel.permissionOverwrites.delete(oldState.member!.id);
		}
	});

	client.on("threadMembersUpdate", async (addedMembers, removedMembers, thread) => {
		if (thread.id !== buildThread) return;
		const vc = client.channels.cache.get(buildVc) as VoiceChannel;
		for (const member of addedMembers.values()) {
			console.log(`${member.user?.username} has joined the build vc!`);
			await vc.permissionOverwrites.create(member.id, {
				ViewChannel: true,
			});
		}
		for (const member of removedMembers.values()) {
			console.log(`${member.user?.username} has left the build vc!`);
			await vc.permissionOverwrites.delete(member.id);
		}
	});
}
