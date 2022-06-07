import { Client, Guild, TextChannel } from "discord.js";
import { Redis } from "ioredis";

const DAILY_USER_THRESHHOLD = 50;

export default function RaidProtection(client: Client, redis: Redis) {
	client.on("guildMemberAdd", async (member) => {
		if (member.guild.id !== "391355330241757205") return;
		if (member.user.bot) return;

		const count = await redis.hincrby("mmd-join-count", new Date().toISOString().split("T")[0], 1);
		if (count > DAILY_USER_THRESHHOLD) {
			console.log(`${count} users have joined today. Deleting invites`);
			const promises = member.guild.invites.cache.map((invite) => invite.delete());
			await Promise.all(promises);
			const modChannel = member.guild.channels.cache.get("688137973698658360") as TextChannel;
			if (modChannel)
				modChannel.send(
					`More than ${DAILY_USER_THRESHHOLD} users joined today. ${promises.length} invite links have been deleted to prevent a raid.`
				);
			else console.log("Couldn't find mod channel");
		}
	});
}
