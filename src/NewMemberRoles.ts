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

		if (member.guild.id === GuildIds.RAWBTV) {
			if (member.roles.highest.name === "@everyone") {
				console.log("Adding RATS role");
				return await member.roles.add(RoleIds.RATS);
			}
		}

		if (member.guild.id === GuildIds.TILII) {
			if (member.roles.highest.name === "@everyone") {
				console.log("Adding Community Member role");
				return await member.roles.add(RoleIds.COMMUNITY_MEMBER);
			}
		}

		//if (member.guild.id === GuildIds.SNEAKYRP) {
		//}
	});
}
