import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	GuildMember,
	Interaction,
	MessageActionRowComponentBuilder,
	SectionBuilder,
	TextDisplayBuilder,
} from "discord.js";
import PocketBase, { ClientResponseError } from "pocketbase";
import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { ButtonIds, UserRecord } from "./types.js";

export default class TwitchLink {
	constructor(public buttonIds: ButtonIds, public db: PocketBase, public server: Express) {
		server.get("/link/twitch", (req, res) => this.handleAuthCallback(req, res));
	}
	interactionCache = new Map<string, ButtonInteraction>();
	timeoutList = new Map<string, NodeJS.Timeout>();

	async HandleButton(interaction: ButtonInteraction) {
		if (interaction.customId === this.buttonIds.TWITCH_ADD)
			return interaction.update({ components: await this.linkTwitch(interaction) });
		if (interaction.customId === this.buttonIds.TWITCH_REMOVE)
			return interaction.update({ components: await this.removeTwitch(interaction) });
	}

	async linkTwitch(interaction: ButtonInteraction) {
		const userRecord = await this.getUserRecord(
			interaction.user.id,
			(interaction.member as GuildMember)?.displayName ?? interaction.user.username
		);

		this.interactionCache.set(interaction.id, interaction);
		this.timeoutList.set(
			interaction.id,
			setTimeout(() => {
				if (this.interactionCache.has(interaction.id)) {
					this.interactionCache.delete(interaction.id);
					interaction.editReply({
						components: [
							new TextDisplayBuilder().setContent("Linking process timed out. Please try again."),
							new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
								new ButtonBuilder()
									.setCustomId(this.buttonIds.TWITCH_ADD)
									.setStyle(ButtonStyle.Success)
									.setLabel("Link Twitch Account"),
								new ButtonBuilder()
									.setCustomId(this.buttonIds.TWITCH_REMOVE)
									.setStyle(ButtonStyle.Secondary)
									.setLabel("Back to Account Management")
							),
						],
					});
				}
			}, 15 * 60 * 1000) // 15 minutes timeout
		);

		const authParams = new URLSearchParams({
			client_id: process.env["TWITCH_CLIENT_ID"]!,
			redirect_uri: process.env["TWITCH_REDIRECT_URI"]!,
			response_type: "code",
			scope: "", //"user:read:email",
			state: interaction.id,
		});
		const authUrl = `https://id.twitch.tv/oauth2/authorize?${authParams.toString()}`;

		return [
			new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`To ${userRecord.twitch_id ? "replace your linked" : "link your"} Twitch account, please click here:`
					)
				)
				.setButtonAccessory(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Link Twitch").setURL(authUrl)),
		];
	}

	async handleAuthCallback(req: ExpressRequest, res: ExpressResponse) {
		const code = req.query.code as string;
		const state = req.query.state as string;

		if (!code || !state) return res.status(400).send("Missing code or state parameter.");
		if (!/^\d{19}$/.test(state)) return res.status(400).send("Invalid state parameter.");

		const interaction = this.interactionCache.get(state);
		if (!interaction) return res.status(400).send("Invalid or expired interaction state.");

		try {
			const userRecord = await this.getUserRecord(
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

			await this.db.collection("lom2_users").update(userRecord.id, {
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
			this.interactionCache.delete(state);
			const timeout = this.timeoutList.get(state);
			if (timeout) {
				clearTimeout(timeout);
				this.timeoutList.delete(state);
			}
			interaction.editReply({
				components: [
					new TextDisplayBuilder().setContent("Twitch account linked successfully!"),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.buttonIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				],
			});
		} catch (error) {
			console.error(error);
			res.status(500).send("An error occurred while linking your Twitch account. Please try again.");
			this.interactionCache.delete(state);
			interaction.editReply({
				components: [
					new TextDisplayBuilder().setContent("An error occurred while linking your Twitch account. Please try again."),
					new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(this.buttonIds.TWITCH_ADD)
							.setStyle(ButtonStyle.Success)
							.setLabel("Link Twitch Account"),
						new ButtonBuilder()
							.setCustomId(this.buttonIds.ACCOUNT_MANAGEMENT)
							.setStyle(ButtonStyle.Secondary)
							.setLabel("Back to Account Management")
					),
				],
			});
		}
	}

	async removeTwitch(interaction: Interaction) {
		const userRecord = await this.getUserRecord(
			interaction.user.id,
			(interaction.member as GuildMember)?.displayName ?? interaction.user.username
		);

		if (!userRecord.twitch)
			return [
				new TextDisplayBuilder().setContent("You have no Twitch account linked."),
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder()
						.setCustomId(this.buttonIds.TWITCH_ADD)
						.setStyle(ButtonStyle.Success)
						.setLabel("Link Twitch Account"),
					new ButtonBuilder()
						.setCustomId(this.buttonIds.ACCOUNT_MANAGEMENT)
						.setStyle(ButtonStyle.Secondary)
						.setLabel("Back to Account Management")
				),
			];

		await this.db.collection("lom2_users").update(userRecord.id, {
			twitch: null,
		} satisfies Partial<UserRecord>);

		return [
			new TextDisplayBuilder().setContent("Twitch account unlinked successfully!"),
			new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(this.buttonIds.ACCOUNT_MANAGEMENT)
					.setStyle(ButtonStyle.Secondary)
					.setLabel("Back to Account Management")
			),
		];
	}

	async getUserRecord(discordId: string, username: string): Promise<UserRecord> {
		try {
			return await this.db.collection("lom2_users").getFirstListItem<UserRecord>(`discord_id = "${discordId}"`);
		} catch (e) {
			if (e instanceof ClientResponseError && e.status === 404) {
				// Create user record if it doesn't exist
				return await this.db.collection("lom2_users").create<UserRecord>({
					discord_id: discordId,
					name: username,
				});
			}
			throw e; // Re-throw if it's not a 404 error
		}
	}
}
