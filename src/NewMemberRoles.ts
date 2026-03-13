import { Client } from "discord.js";

enum GuildIds {
	RAWBTV = "391355330241757205",
	TILII = "768372809616850964",
	SNEAKYRP = "725854554939457657",
}

enum RoleIds {
	RATS = "631608275883917332",
	COMMUNITY_MEMBER = "823624104900689961",
}

export default function NewMemberRoles(client: Client) {
	client.on("guildMemberAdd", async (member): Promise<any> => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await member.fetch(true);

		console.log(
			`${member.user.username}#${member.user.discriminator} has joined ${member.guild.name}`,
			member.roles.cache.map((r) => r.name)
		);

		// if (member.guild.id === GuildIds.RAWBTV) {
		// 	if (member.roles.highest.name === "@everyone") {
		// 		console.log("Adding RATS role");
		// 		return await member.roles.add(RoleIds.RATS);
		// 	}
		// }

		if (member.guild.id === GuildIds.TILII) {
			if (member.roles.highest.name === "@everyone") {
				console.log("Adding Community Member role");
				return await member.roles.add(RoleIds.COMMUNITY_MEMBER);
			}
		}
	});

	client.on('guildMemberUpdate', (oldMember, newMember) => {
		if (!newMember.roles.cache.some(r => [
			"586309003441733648", //vip
			"413104808334196757", //angel
			"444327585103478794", //dragon
			"413104736636502026", //boss
			"444770697106030602", //sneaky
			"1011423880562348172", //yt
			"642410419549372418", //Twitch
			"585547861291171853", //nitro
			"631608275883917332", //rats
		])) newMember.roles.add("631608275883917332");
	});
}
