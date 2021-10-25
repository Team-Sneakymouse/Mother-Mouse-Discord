import { Client } from "discord.js";
export default function NewMemberRoles(client: Client) {
	client.on("guildMemberAdd", async (member): Promise<any> => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await member.fetch(true);
		console.log(
			`${member.user.username}#${member.user.discriminator} has joined ${member.guild.name} with roles: ${member.roles.cache
				.map((r) => r.name)
				.join(",")}`
		);

		// rawb.tv
		if (member.guild.id === "391355330241757205") {
			if (member.roles.highest.name === "@everyone") {
				return await member.roles.add("631608275883917332"); // Rats
			}
		}

		// TILII
		if (member.guild.id === "768372809616850964") {
			if (member.roles.highest.name === "@everyone") {
				return await member.roles.add("823624104900689961"); // Community Member
			}
		}

		// SneakyRP
		//if (member.guild.id === "725854554939457657") {
		//}
	});
}
