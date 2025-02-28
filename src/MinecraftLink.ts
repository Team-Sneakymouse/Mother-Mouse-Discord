import { Client, GuildMember, InteractionResponse, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
export const data = [
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Minecraft account to your Discord account")
		.addStringOption(new SlashCommandStringOption().setName("token").setDescription("Link token from Minecraft").setRequired(false)),
	new SlashCommandBuilder()
		.setName("accounts") //
		.setDescription("Manage your linked accounts"),
];

type UserRecord = RecordModel & {
	discord_id: string;
	name: string;
};
type AccountRecord = RecordModel & {
	name: string;
	owner: string;
	main: boolean;
	expand: {
		owner: {
			discord_id: string;
		};
	};
};
type LinkRecord = RecordModel & {
	user: string;
	account: string;
	link_token: string;
};

export default function DvzRegistrations(client: Client, db: PocketBase) {
	const inFlight = new Set<string>();

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "link") {
			const token = interaction.options.getString("token", false);
			if (token && token.length !== 5) {
				await interaction.reply({
					content: "Invalid link token.",
					ephemeral: true,
				});
				return;
			}

			if (inFlight.has(interaction.user.id)) {
				await interaction.reply({
					content: "You're already in the process of linking your account. Please wait.",
					ephemeral: true,
				});
				return;
			}
			inFlight.add(interaction.user.id);
			await (
				(async () => {
					// Get user record
					let userRecord = await db
						.collection("lom2_users")
						.getFirstListItem<UserRecord>(`discord_id = "${interaction.user.id}"`)
						.catch(() => null);
					if (!userRecord)
						try {
							userRecord = await db.collection("lom2_users").create<UserRecord>({
								discord_id: interaction.user.id,
								name: (interaction.member as GuildMember)?.displayName ?? interaction.user.username,
							});
						} catch {
							return await interaction.reply({
								content: "Failed to create user record. Please tell Dani.",
								ephemeral: true,
							});
						}

					// Check token argument
					if (!token) {
						// Check if a token already exists
						const linkRecord = await db
							.collection("minecraft_link")
							.getFirstListItem<LinkRecord>(`user = "${userRecord.id}"`)
							.catch(() => null);
						if (linkRecord)
							// Token already exists
							return await interaction.reply({
								content:
									"In Minecraft, please run this command to link your account:```/link " + linkRecord.link_token + "```",
								ephemeral: true,
							});

						// Generate link token
						let token = "";
						for (let i = 0; i < 5; i++) {
							const testToken = (Math.floor(Math.random() * 90000) + 10000).toString();
							// Check for token collision
							const tokenCheckRecord = await db
								.collection("minecraft_link")
								.getFirstListItem<LinkRecord>(`link_token = "${testToken}"`)
								.catch(() => null);
							if (!tokenCheckRecord) {
								token = testToken;
								break;
							}
						}
						if (!token)
							// Exhausted attempts to generate token
							return await interaction.reply({
								content: "Failed to generate link token. Please tell Dani.",
								ephemeral: true,
							});

						// Save link record with token
						const createRecord = await db
							.collection("minecraft_link")
							.create<LinkRecord>({
								user: userRecord.id,
								link_token: token,
							})
							.catch(() => null);
						if (!createRecord)
							return await interaction.reply({
								content: "Failed to save link record. Please tell Dani.",
								ephemeral: true,
							});

						// Send token to user
						return await interaction.reply({
							content: "In Minecraft, please run this command to link your account:```/link " + token + "```",
							ephemeral: true,
						});
					}

					// Find token in database
					const linkRecords = await db
						.collection("minecraft_link")
						.getList<LinkRecord>(1, 1, { filter: `link_token = "${token}"` })
						.catch(() => null);
					if (!linkRecords)
						return await interaction.reply({
							content: "Failed to check link token. Please tell Dani.",
							ephemeral: true,
						});

					const linkRecord = linkRecords.items.at(0);
					if (!linkRecord)
						// No record found
						return await interaction.reply({
							content: "Invalid link token.",
							ephemeral: true,
						});

					// Token is for Minecraft, not Discord
					if (linkRecord.account == "") {
						if (linkRecord.user != userRecord.id)
							// Token belongs to another user
							return await interaction.reply({
								content: "This token is meant for another user's Minecraft account. What are you trying to pull?",
								ephemeral: true,
							});
						else
							return await interaction.reply({
								content: "Please run this command **in Minecraft** to link your account:```/link " + token + "```",
								ephemeral: true,
							});
					}

					// Check if user has other linked accounts
					const otherAccounts = await db
						.collection("lom2_accounts")
						.getFullList<AccountRecord>({ filter: `owner.id = "${userRecord.id}"` })
						.catch(() => null);
					if (!otherAccounts)
						return await interaction.reply({
							content: "Failed to check linked accounts. Please tell Dani.",
							ephemeral: true,
						});
					const otherMain = otherAccounts.find((account) => account.main);

					// Link account to user
					const updateResult = await db
						.collection("lom2_accounts")
						.update<AccountRecord>(linkRecord.account, {
							owner: userRecord.id,
							main: !otherMain,
						})
						.catch(() => null);
					if (!updateResult)
						return await interaction.reply({
							content: "Failed to link account. Please tell Dani.",
							ephemeral: true,
						});

					// Delete link record
					const deleteResult = await db
						.collection("minecraft_link")
						.delete(linkRecord.id)
						.catch(() => null);

					if (!deleteResult)
						return await interaction.reply({
							content: "Failed to clean up. Please tell Dani.",
							ephemeral: true,
						});

					return await interaction.reply({
						content: "Account linked successfully.",
						ephemeral: true,
					});
				}) satisfies () => Promise<InteractionResponse>
			)();
			inFlight.delete(interaction.user.id);
		}

		if (interaction.isChatInputCommand() && interaction.commandName === "accounts") {
			// Fetch user's accounts
			const linkRecords = await db
				.collection("lom2_accounts")
				.getFullList<AccountRecord>({ filter: `owner.discord_id = "${interaction.user.id}"` })
				.catch(() => null);
			if (!linkRecords) {
				await interaction.reply({
					content: "Failed to check link records. Please tell Dani.",
					ephemeral: true,
				});
				return;
			}

			if (linkRecords.length === 0) {
				await interaction.reply({
					content: "You don't have any linked accounts. Use </link:1322849683239866378> to get started.",
					ephemeral: true,
				});
				return;
			}

			await interaction.reply({
				content: `Your linked accounts:\n${linkRecords
					.map((record) => `• ${record.name}${record.main ? " (main)" : ""}`)
					.join("\n")}`,
				ephemeral: true,
			});
		}
	});
}
