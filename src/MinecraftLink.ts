import {
	ButtonBuilder,
	ButtonStyle,
	ChatInputCommandInteraction,
	Client,
	GuildMember,
	MessageFlagsBitField,
	SectionBuilder,
	SlashCommandBuilder,
	SlashCommandStringOption,
	TextDisplayBuilder,
} from "discord.js";
import PocketBase, { ClientResponseError, RecordModel } from "pocketbase";
import type { Express } from "express";

export const data = [
	new SlashCommandBuilder()
		.setName("link")
		.setDescription("Link your Minecraft account to your Discord account")
		.addStringOption(new SlashCommandStringOption().setName("token").setDescription("Link token from Minecraft").setRequired(false))
		.addStringOption(
			new SlashCommandStringOption()
				.setName("platform")
				.setDescription("Select platform to link")
				.setChoices({ name: "Minecraft", value: "minecraft" }, { name: "Twitch", value: "twitch" })
				.setRequired(false)
		),
	new SlashCommandBuilder()
		.setName("accounts") //
		.setDescription("Manage your linked accounts"),
];

type UserRecord = RecordModel & {
	name: string;
	discord_id: string;
	twitch: {
		id?: string;
		display_name?: string;
		profile_image_url?: string;
		token?: {
			access_token: string;
			refresh_token: string;
			expires_at: number;
			scope: string[];
		};
	} | null;
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

export default function DvzRegistrations(client: Client, db: PocketBase, server: Express) {
	const inFlight = new Set<string>();
	const interactionCache = new Map<string, ChatInputCommandInteraction>();

	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "link") {
			const platform = interaction.options.getString("platform", false);
			if (platform === "twitch") {
				await linkTwitch(interaction);
				return;
			}

			const token = interaction.options.getString("token", false);
			if (token && token.length !== 5) {
				await interaction.reply({
					content: "Invalid link token.",
					ephemeral: true,
				});
				return;
			}

			await linkMinecraft(interaction, token);
			return;
		}
	});

	async function linkMinecraft(interaction: ChatInputCommandInteraction, token: string | null) {
		if (inFlight.has(interaction.user.id)) {
			await interaction.reply({
				content: "You're already in the process of linking your account. Please wait.",
				ephemeral: true,
			});
			return;
		}
		inFlight.add(interaction.user.id);
		try {
			// Get user record
			const userRecord = await getUserRecord(
				interaction.user.id,
				(interaction.member as GuildMember)?.displayName ?? interaction.user.username
			);

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
						content: "In Minecraft, please run this command to link your account:```/link " + linkRecord.link_token + "```",
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
		} finally {
			inFlight.delete(interaction.user.id);
		}
	}

	async function linkTwitch(interaction: ChatInputCommandInteraction) {
		const userRecord = await getUserRecord(
			interaction.user.id,
			(interaction.member as GuildMember)?.displayName ?? interaction.user.username
		);

		interactionCache.set(interaction.id, interaction);
		setTimeout(() => {
			if (interactionCache.has(interaction.id)) {
				interactionCache.delete(interaction.id);
				interaction.editReply({
					content: "Linking process timed out. Please try again.",
				});
			}
		}, 15 * 60 * 1000); // 15 minutes timeout

		const authParams = new URLSearchParams({
			client_id: process.env["TWITCH_CLIENT_ID"]!,
			redirect_uri: process.env["TWITCH_REDIRECT_URI"]!,
			response_type: "code",
			scope: "", //"user:read:email",
			state: interaction.id,
		});
		const authUrl = `https://id.twitch.tv/oauth2/authorize?${authParams.toString()}`;

		interaction.reply({
			flags: MessageFlagsBitField.Flags.Ephemeral | MessageFlagsBitField.Flags.IsComponentsV2,
			components: [
				new SectionBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`To ${userRecord.twitch_id ? "replace your linked" : "link your"} Twitch account, please click here:`
						)
					)
					.setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Link Twitch").setURL(authUrl)),
			],
		});
	}

	server.get("/link/twitch", async (req, res) => {
		const code = req.query.code as string;
		const state = req.query.state as string;

		if (!code || !state) return res.status(400).send("Missing code or state parameter.");
		if (!/^\d{19}$/.test(state)) return res.status(400).send("Invalid state parameter.");

		const interaction = interactionCache.get(state);
		if (!interaction) return res.status(400).send("Invalid or expired interaction state.");

		try {
			const userRecord = await getUserRecord(
				interaction.user.id,
				(interaction.member as GuildMember)?.displayName ?? interaction.user.username
			);

			const tokenRequestParams = new URLSearchParams({
				client_id: process.env["TWITCH_CLIENT_ID"]!,
				client_secret: process.env["TWITCH_CLIENT_SECRET"]!,
				code: code,
				grant_type: "authorization_code",
				redirect_uri: process.env["TWITCH_REDIRECT_URI"]!,
			});
			const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: tokenRequestParams.toString(),
			});
			if (!tokenResponse.ok) {
				const errorText = await tokenResponse.text();
				console.error("Twitch token request failed:", errorText);
				return res.status(500).send("Failed to obtain access token from Twitch.");
			}
			const tokenData = await tokenResponse.json();
			if (!tokenData.access_token) {
				console.error("Twitch token response did not contain access_token:", tokenData);
				return res.status(500).send("Failed to obtain access token from Twitch.");
			}

			const userResponse = await fetch("https://api.twitch.tv/helix/users", {
				headers: {
					"Client-ID": process.env["TWITCH_CLIENT_ID"]!,
					Authorization: `Bearer ${tokenData.access_token}`,
				},
			});
			const userData = await userResponse.json();

			if (!userData.data || userData.data.length === 0) {
				return res.status(500).send("Failed to obtain user data from Twitch.");
			}

			const twitchId = userData.data[0].id;

			await db.collection("lom2_users").update(userRecord.id, {
				twitch: {
					id: twitchId,
					display_name: userData.data[0].display_name,
					profile_image_url: userData.data[0].profile_image_url,
					token: {
						access_token: tokenData.access_token ?? null,
						refresh_token: tokenData.refresh_token ?? null,
						expires_at: Date.now() + (tokenData.expires_in ?? 0) * 1000,
						scope: tokenData.scope ? (typeof tokenData.scope === "string" ? tokenData.scope.split(" ") : tokenData.scope) : [],
					},
				},
			} satisfies Partial<UserRecord>);

			res.send("Twitch account linked successfully! You can close this tab and return to Discord.");
			interactionCache.delete(state);
			interaction.editReply({
				components: [new TextDisplayBuilder().setContent("Twitch account linked successfully!")],
			});
		} catch (error) {
			console.error(error);
			res.status(500).send("An error occurred while linking your Twitch account. Please try again.");
			interactionCache.delete(state);
			interaction.editReply({
				components: [new TextDisplayBuilder().setContent("An error occurred while linking your Twitch account. Please try again.")],
			});
		}
	});

	async function getUserRecord(discordId: string, username: string): Promise<UserRecord> {
		try {
			return await db.collection("lom2_users").getFirstListItem<UserRecord>(`discord_id = "${discordId}"`);
		} catch (e) {
			if (e instanceof ClientResponseError && e.status === 404) {
				// Create user record if it doesn't exist
				return await db.collection("lom2_users").create<UserRecord>({
					discord_id: discordId,
					name: username,
				});
			}
			throw e; // Re-throw if it's not a 404 error
		}
	}
}
