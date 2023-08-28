import { Routes, type Client, ApplicationRoleConnectionMetadataType } from "discord.js";
import type { REST } from "@discordjs/rest";
import type { Express } from "express";
import cookieParser from "cookie-parser";
import type PocketBase from "pocketbase";

export const metadata: { key: keyof Metadata; name: string; description: string; type: ApplicationRoleConnectionMetadataType }[] = [
	{
		key: "gold",
		name: "Gold",
		description: "Amount of gold",
		type: ApplicationRoleConnectionMetadataType.IntegerGreaterThanOrEqual,
	},
	{
		key: "plot_expires",
		name: "Plot expiration",
		description: "Date of plot expiration",
		type: ApplicationRoleConnectionMetadataType.DatetimeGreaterThanOrEqual,
	},
	{
		key: "vibing",
		name: "Is vibing",
		description: "whether user us vibing",
		type: ApplicationRoleConnectionMetadataType.BooleanEqual,
	},
];

export default function LinkedRole(client: Client, restClient: REST, server: Express, pocketbase: PocketBase) {
	const cookie = cookieParser(process.env["COOKIE_SECRET"]);

	server.get("/linkedrole", cookie, async (req, res) => {
		const { url, state } = getOauthUrl();

		res.cookie("state", state, { maxAge: 5 * 60 * 1000, signed: true, httpOnly: true });
		res.redirect(url);
	});

	server.get("/linkedrole/callback", cookie, async (req, res) => {
		try {
			const code = req.query.code as string;
			const discordState = req.query.state as string;
			const clientState = req.signedCookies.state as string;

			if (discordState !== clientState) {
				res.status(403).send("Invalid state");
				return;
			}

			const tokens = await getOauthTokens(code);

			const user = (await restClient.get(Routes.user(), {
				auth: false,
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
				},
			})) as {
				id: string;
				username: string;
				global_name: string | null;
				avatar: string | null;
			};
			console.log(user.global_name);

			// store the tokens in the database

			res.send("Linking complete! You can close this tab now and return to Discord.");
			pushMetadata(user.id, tokens, {
				gold: 5,
				plot_expires: "2023-08-31",
				vibing: true,
			});
		} catch (e) {
			console.error(e);
			res.status(500).send("An error occurred. Please tell Dani!");
		}
	});

	function getOauthUrl() {
		const state = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");

		const params = new URLSearchParams({
			client_id: process.env["DISCORD_CLIENTID"]!,
			redirect_uri: process.env["DISCORD_REDIRECT_URI"]!,
			response_type: "code",
			state: state,
			scope: "role_connections.write identify",
			prompt: "consent",
		});

		return {
			url: `https://discord.com/api/oauth2/authorize?${params}`,
			state: state,
		};
	}

	async function getOauthTokens(code: string) {
		const data = (await restClient.post(Routes.oauth2TokenExchange(), {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			passThroughBody: true,
			body: new URLSearchParams({
				client_id: process.env["DISCORD_CLIENTID"]!,
				client_secret: process.env["DISCORD_CLIENT_SECRET"]!,
				grant_type: "authorization_code",
				code: code,
				redirect_uri: process.env["DISCORD_REDIRECT_URI"]!,
			}),
		})) as Tokens;
		data.expires_at = Date.now() + data.expires_in * 1000;
		console.log(data);
		return data;
	}

	async function getAccessToken(userId: string, tokens: Tokens) {
		if (Date.now() > tokens.expires_at) {
			const data = (await restClient.post(Routes.oauth2TokenExchange(), {
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				passThroughBody: true,
				body: new URLSearchParams({
					client_id: process.env["DISCORD_CLIENTID"]!,
					client_secret: process.env["DISCORD_CLIENT_SECRET"]!,
					grant_type: "refresh_token",
					refresh_token: tokens.refresh_token,
				}),
			})) as Tokens;
			tokens.access_token = data.access_token;
			tokens.expires_in = data.expires_in;
			tokens.expires_at = Date.now() + data.expires_in * 1000;
			// save tokens
		}
		return tokens.access_token;
	}

	async function pushMetadata(userId: string, tokens: Tokens, metadata: Metadata) {
		await restClient.put(Routes.userApplicationRoleConnection(client.application!.id), {
			auth: false,
			headers: {
				Authorization: `Bearer ${tokens.access_token}`,
			},
			body: {
				platform_name: "Lords of Minecraft 2",
				platform_username: client.users.cache.get(userId)?.username ?? "Error",
				metadata,
			},
		});
	}
}

type Tokens = {
	access_token: string;
	token_type: string;
	expires_in: number;
	expires_at: number;
	refresh_token: string;
	scope: string;
};

type Metadata = {
	gold: number;
	plot_expires: string;
	vibing: boolean;
};
