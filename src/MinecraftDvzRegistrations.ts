import {
	Client,
	GuildMember,
	InteractionReplyOptions,
	SlashCommandBuilder,
	SlashCommandIntegerOption,
	SlashCommandStringOption,
	TextChannel,
} from "discord.js";
import PocketBase, { Record as PBRecord } from "pocketbase";
import MulticraftAPI from "./utils/multicraft.js";
export const data = [
	new SlashCommandBuilder()
		.setName("register")
		.setDescription("Register for this weeks whitelist raffle")
		.addStringOption(new SlashCommandStringOption().setName("username").setDescription("Minecraft username").setRequired(true)),
	new SlashCommandBuilder().setName("unregister").setDescription("Unregister from this weeks whitelist raffle"),
	new SlashCommandBuilder().setName("dvz_open").setDescription("Open whitelist registrations"),
	new SlashCommandBuilder().setName("dvz_close").setDescription("Close whitelist registrations"),
	new SlashCommandBuilder()
		.setName("dvz-whitelist")
		.setDescription("Whitelist additional players")
		.addIntegerOption(
			new SlashCommandIntegerOption().setName("player_count").setDescription("Number of players (default: 50)").setRequired(false)
		)
		.setDefaultMemberPermissions(0),
];

const DVZ_SERVER_ID = 14;
const REPLIES = {
	error: (message: string, raw: Partial<InteractionReplyOptions> = {}) => ({
		content: "",
		embeds: [
			{
				title: "Error",
				description: message,
				color: 0xa01a04,
			},
		],
		...raw,
	}),
	info: (message: string, raw: Partial<InteractionReplyOptions> = {}) => ({
		content: "",
		embeds: [
			{
				title: "Info",
				description: message,
				color: 0x247db9,
			},
		],
		...raw,
	}),
	registered: (username: string, uuid: string) => ({
		content: "",
		embeds: [
			{
				title: "Success",
				description: `Whitelist registration of \`${username}\` has been received.`,
				color: 0x4db924,
				thumbnail: {
					url: `https://crafatar.com/renders/body/${uuid}?overlay`,
				},
			},
		],
	}),
} satisfies Record<string, (...args: any[]) => InteractionReplyOptions>;

const ROLE_TICKETS = {
	"932370313541460038": -1, // Birthday Mouse, guaranteed
	"586309003441733648": 5, // VIPs
	"1098628623461789757": 2, // Knight
	"413104808334196757": 5, // Patreon 100
	"444327585103478794": 3, // Patreon 25
	"413104736636502026": 2, // Patreon 10
	"444770697106030602": 1, // Patreon 1
	"1011423880562348174": 2, // YouTube 7
	"1011423880562348173": 1, // YouTube 3.5
	"689250596532125741": 3, // Twitch 18
	"689250596532125738": 2, // Twitch 7
	"689250596532125737": 1, // Twitch 3.5
};

const DISCORD_IDS = {
	AZ: "328625776381394966",
	VID: "265285564905947136",
};

const pendingRegistrations = new Map<string, string>();

export default function DvzRegistrations(client: Client, db: PocketBase, multicraft: MulticraftAPI) {
	client.on("interactionCreate", async (interaction) => {
		if (interaction.isChatInputCommand() && interaction.commandName === "dvz_open") {
			const registrationOpen = await db
				.collection("settings")
				.getFirstListItem<PBRecord & { value: boolean }>('key="dvz_registrations_open"');
			if (typeof registrationOpen.value !== "boolean") throw new Error("setting 'dvz_registrations_open' is not a boolean");
			if (registrationOpen.value === true) {
				await interaction.reply(REPLIES.error("Registrations are already open", { ephemeral: true }));
				return;
			}
			await db.collection("settings").update(registrationOpen.id, { value: true });

			await interaction.deferReply();
			const users = await db.collection("dvz_users").getFullList<PBRecord & DvzUserRecord>(undefined, {
				filter: 'tickets!=0 || uuid!=""',
			});
			for (const user of users) {
				user.tickets = 0;
				user.uuid = "";
				await db.collection("dvz_users").update(user.id, user);
			}
			console.log(`Unregistered ${users.length} users.`);

			await interaction.followUp(
				REPLIES.info("**Registrations are now open.**\nUse `/register <minecraft_username>` to register for the next game.")
			);
			return;
		} else if (interaction.isChatInputCommand() && interaction.commandName === "dvz_close") {
			const registrationOpen = await db
				.collection("settings")
				.getFirstListItem<PBRecord & { value: boolean }>('key="dvz_registrations_open"');
			if (typeof registrationOpen.value !== "boolean") throw new Error("setting 'dvz_registrations_open' is not a boolean");
			if (registrationOpen.value === false) {
				await interaction.reply(REPLIES.error("Registrations are already closed", { ephemeral: true }));
				return;
			}
			await db.collection("settings").update(registrationOpen.id, { value: false });

			await interaction.reply(REPLIES.info("Registrations are now closed."));
			return;
		} else if (interaction.isChatInputCommand() && interaction.commandName === "register") {
			if (!interaction.member) {
				await interaction.reply(REPLIES.error("You must be in a server to register."));
				return;
			}

			const username = interaction.options.getString("username", true);
			const registrationOpen = await db
				.collection("settings")
				.getFirstListItem<PBRecord & { value: boolean }>('key="dvz_registrations_open"');
			if (typeof registrationOpen.value !== "boolean") throw new Error("setting 'dvz_registrations_open' is not a boolean");

			const registrerUrl = pendingRegistrations.get(interaction.user.id);
			if (registrerUrl) {
				await interaction.reply(
					REPLIES.error("Your registration is pending. Please wait for it to complete: " + registrerUrl, { ephemeral: true })
				);
				return;
			}

			// Sign up user
			// Check if registrations are open
			if (registrationOpen.value === false) {
				await interaction.reply(
					REPLIES.error(
						"Registrations are not currently open. You'll be able to register at the start of the next game.\nKeep an eye on https://whenisdvz.rawb.tv for dates."
					)
				);
				pendingRegistrations.delete(interaction.user.id);
				return;
			}

			const reply = await (await interaction.deferReply()).fetch();
			pendingRegistrations.set(interaction.user.id, reply.url);

			// Get uuid from username
			let profile: {
				name: string;
				id: string;
			} | null;
			try {
				profile = await usernameToProfile(username);
			} catch (e) {
				await interaction.editReply(
					REPLIES.error(`Error: Username lookup failed. Please try again.\nIf this keeps happening, please ping Dani.`, {
						ephemeral: true,
					})
				);
				pendingRegistrations.delete(interaction.user.id);
				return;
			}
			if (!profile) {
				await interaction.editReply(REPLIES.error(`Minecraft account \`${username}\` does not exist.`));
				pendingRegistrations.delete(interaction.user.id);
				return;
			}

			// Check if user or minecraft account is already registered
			let user: (PBRecord & DvzUserRecord) | null = await db
				.collection("dvz_users")
				.getFirstListItem<PBRecord & DvzUserRecord>(`discordId="${interaction.user.id}" || uuid="${profile.id}"`)
				.catch(() => null);
			if (user && user.uuid !== "") {
				let error = "You are already registered. Good luck in the next whitelist raffle!";
				if (user.discordId !== interaction.user.id) {
					error = `Minecraft account \`${profile.name}\` is already registered to another Discord account.`;
				} else if (user.uuid !== profile.id) {
					const oldUsername = await uuidToProfile(user.uuid);
					error = `You are already registered with the Minecraft account \`${oldUsername}\`.\nIf you want to change your Minecraft account, use /unregister.`;
				}
				await interaction.editReply(REPLIES.error(error));
				pendingRegistrations.delete(interaction.user.id);
				return;
			}

			// Calculate tickets
			let tickets = 1;
			const userRoles = Array.isArray(interaction.member.roles)
				? interaction.member.roles
				: Array.from(interaction.member.roles.cache.keys());
			function rolePresent(role: string): role is keyof typeof ROLE_TICKETS {
				return role in ROLE_TICKETS;
			}
			for (const role of userRoles) {
				if (rolePresent(role)) {
					// Birthday Mouse gets in guaranteed
					if (ROLE_TICKETS[role] === -1) {
						tickets = -1;
						break;
					}

					// Sneaky Boss should be ignored on higher Patreon roles
					if (
						role === "413104736636502026" && // Sneaky Boss
						(userRoles.includes("444327585103478794") || userRoles.includes("413104808334196757")) // Sneaky Dragon, Sneaky Angel
					)
						continue;

					tickets += ROLE_TICKETS[role];
				}
			}

			// Update user db
			if (user) {
				user.uuid = profile.id;
				user.username = profile.name;
				user.tickets = tickets;
				if (!user.usernames) user.usernames = [profile.name];
				if (!user.usernames.includes(profile.name)) user.usernames.push(profile.name);
				await db.collection("dvz_users").update(user.id, user);
			} else {
				await db.collection("dvz_users").create({
					discordId: interaction.user.id,
					uuid: profile.id,
					username: profile.name,
					tickets: tickets,
					usernames: [profile.name],
				});
			}

			// Send reply
			await interaction.editReply(REPLIES.registered(profile.name, profile.id));
			pendingRegistrations.delete(interaction.user.id);
			return;
		} else if (interaction.isChatInputCommand() && interaction.commandName === "unregister") {
			let user = await db
				.collection("dvz_users")
				.getFirstListItem<PBRecord & DvzUserRecord>(`discordId="${interaction.user.id}" && uuid!=""`)
				.catch(() => null);
			if (!user) {
				await interaction.reply(REPLIES.error("You are not yet registered for the next game."));
				return;
			}

			user.uuid = "";
			user.tickets = 0;
			await db.collection("dvz_users").update(user.id, user);

			await interaction.reply(REPLIES.info("You have been unregistered from the next game."));
			return;
		} else if (interaction.isChatInputCommand() && interaction.commandName === "dvz-whitelist") {
			await interaction.deferReply();
			const dvzRole = interaction.guild!.roles.cache.get("1074038162885714032");
			let removedRoles = 0;
			if (dvzRole) {
				for (const member of dvzRole.members.values()) {
					await member.roles.remove("1074038162885714032");
					removedRoles++;
				}
				console.log(`Removed ${removedRoles} users from the role.`);
			}

			const amount = interaction.options.getInteger("player_count", false) ?? 50;

			const games = await db.collection("dvz_games").getFullList<PBRecord & DvzGameRecord>(undefined, {
				filter: `name~"${new Date().toISOString().split("T")[0]}"`,
			});
			const gameId = Math.max(...games.map((g) => Number(g.name.split("/")[1] || "0") || 0), 0) + 1;
			const game: DvzGameRecord = { name: `${new Date().toISOString().split("T")[0]}/${gameId}` };

			const pastParticipants = new Set(games.flatMap((g) => g.participants || []));
			const users = await db.collection("dvz_users").getFullList<PBRecord & DvzUserRecord>(undefined, {
				filter: 'tickets!=0 && uuid!="" && banned=false',
			});
			console.log(`Registering ${amount}/${users.length} users for game ${game.name}:`);

			const ticketPool: (PBRecord & DvzUserRecord)[] = [];
			const selectedUsers = new Set<PBRecord & DvzUserRecord>();
			const backupUsers = new Set<PBRecord & DvzUserRecord>();
			for (const user of users) {
				if (false && pastParticipants.has(user.id)) {
					backupUsers.add(user);
					continue;
				}
				if (user.tickets === -1) {
					selectedUsers.add(user);
					continue;
				}
				ticketPool.push(...new Array(user.tickets).fill(user));
			}

			while (selectedUsers.size < amount && ticketPool.length > 0) {
				console.log(selectedUsers.size, ticketPool.length);
				const index = Math.floor(Math.random() * ticketPool.length);
				selectedUsers.add(ticketPool[index]);
				ticketPool.splice(index, 1);

				if (!ticketPool[index]) continue;
				// Prevent Az and Vid from being selected separately
				if (ticketPool[index].discordId === DISCORD_IDS.AZ) {
					const vid = ticketPool.find((u) => u.discordId === DISCORD_IDS.VID);
					if (vid) selectedUsers.add(vid);
				} else if (ticketPool[index].discordId === DISCORD_IDS.VID) {
					const az = ticketPool.find((u) => u.discordId === DISCORD_IDS.AZ);
					if (az) selectedUsers.add(az);
				}
			}

			console.log("Registered users", users.length);
			console.log(
				"Selected users",
				selectedUsers.size,
				[...selectedUsers].map((u) => u.tickets)
			);

			if (selectedUsers.size < amount) {
				console.log(`Adding ${amount - selectedUsers.size} backup users`);
				for (const user of [...backupUsers].sort((a, b) => b.tickets - a.tickets)) {
					selectedUsers.add(user);
					if (selectedUsers.size >= amount) break;
				}
			} else {
				console.log("Backup not needed");
			}
			game.participants = [...selectedUsers].map((u) => u.id);

			for (const user of selectedUsers) {
				const commandResponse = await multicraft.call("sendConsoleCommand", {
					server_id: DVZ_SERVER_ID,
					command: `whitelist add ${user.username}`,
				});
				if (!commandResponse.success) {
					await interaction.reply(REPLIES.error(`An error occurred while ${user.username} the account to the whitelist.`));
					console.error("Multicraft error", JSON.stringify(commandResponse.errors, null, 2));
					return;
				}

				const member = await interaction.guild?.members
					.fetch(user.discordId)
					.then((member) => member.roles.add("1074038162885714032"));
				if (!member) {
					console.error("Failed to add role to", user.username);
				}

				console.log("Whitelisted", user.username);
			}
			await db.collection("dvz_games").create(game);
			await interaction.followUp(
				REPLIES.info(
					`Whitelisted **${selectedUsers.size}**/${amount} users:\n${[...selectedUsers]
						.map((u) => `<@${u.discordId}>`)
						.join("\n")}\n\nPlease check <#1074038036234502224> for the server address to connect`
				)
			);

			const dvzInfoChannel = client.channels.cache.get("1074038036234502224") as TextChannel;
			if (!dvzInfoChannel) console.error("Failed to find DVZ info channel");
			else
				await dvzInfoChannel.send({
					content: "@everyone, you can now connect to the using the address above 👆",
				});
		}
	});
}

async function usernameToProfile(username: string) {
	let res: Response;
	try {
		res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);
	} catch (e) {
		console.error("Fetch error", e);
		throw new Error("Fetch error");
	}
	while (res.status === 429) {
		console.log("Mojang API rate limit, retrying in 1s");
		await new Promise((resolve) => setTimeout(resolve, 1000));
		res = await fetch("https://api.mojang.com/users/profiles/minecraft/" + username);
	}
	if (res.status === 204 || res.status === 404) return null;
	if (res.status !== 200) {
		console.error("Mojang API error", res.status, res.statusText, await res.text());
		throw new Error("Mojang API error");
	}
	return (await res.json()) as { name: string; id: string };
}

async function uuidToProfile(uuid: string) {
	const res = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`);
	if (res.status === 400) throw new Error("Invalid UUID");
	if (res.status === 204) return null;
	if (res.status !== 200) {
		console.error("Mojang API error", res.status, res.statusText, await res.text());
		throw new Error("Mojang API error");
	}
	const { name } = (await res.json()) as { name: string };
	return name;
}

type DvzUserRecord = {
	discordId: string;
	uuid: string;
	username: string;
	tickets: number;
	usernames: null | string[];
};

type DvzGameRecord = {
	name: string;
	description?: string;
	participants?: string[];
};
