import { type ChatInputCommandInteraction, type Client, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { AccountStore } from "./AccountManagement/store.js";

const RAWBTV_GUILD_ID = "391355330241757205";
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const ITEM_IDS = [
	"item-EXPP",
	"item-bowl",
	"item-box",
	"item-brick",
	"item-crowbar",
	"item-flaskofcorruption",
	"item-glue",
	"item-koboldbrew",
	"item-largeManaPotion",
	"item-legalswammies",
	"item-mukpie",
	"item-oil",
	"item-omegastone",
	"item-pearl",
	"item-scryingprism",
	"item-seafoam",
	"item-soulstone",
	"item-stone",
	"item-superdynamite",
	"item-wrench",
] as const;
type ItemId = (typeof ITEM_IDS)[number];

type MailRecord = RecordModel & {
	sender_name: string;
	recipient_name: string;
	note: string;
	available: true;
	rewards: { type: "command"; command: string }[];
};

export const data = [
	new SlashCommandBuilder()
		.setName("sendmail")
		.setDescription("Send an item to every account active in the past two weeks")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addStringOption(
			new SlashCommandStringOption()
				.setName("item")
				.setDescription("Item to send")
				.setRequired(true)
				.addChoices(...ITEM_IDS.map((item) => ({ name: item, value: item }))),
		),
];

/** Accounts come from SneakyUserMeta's tables (`accounts.last_seen`); the mail itself still goes to PocketBase. */
export default function SendMail(client: Client, db: PocketBase, accounts: AccountStore | null): void {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isChatInputCommand() || interaction.commandName !== "sendmail") return;
		await handleSendMail(interaction, db, accounts);
	});
}

async function handleSendMail(interaction: ChatInputCommandInteraction, db: PocketBase, store: AccountStore | null): Promise<void> {
	if (interaction.guildId !== RAWBTV_GUILD_ID || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral });
		return;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	const item = interaction.options.getString("item", true);
	if (!ITEM_IDS.includes(item as ItemId)) {
		await interaction.editReply(`Unknown item: ${item}`);
		return;
	}

	const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
	if (!store) {
		await interaction.editReply("The accounts database isn't configured (PGHOST). No mail was sent.");
		return;
	}
	let accounts: Array<{ uuid: string; name: string }>;
	try {
		accounts = await store.accountsSeenSince(activeSince);
	} catch (error) {
		console.error(`Failed to fetch accounts active since ${activeSince.toISOString()}`, error);
		await interaction.editReply("Failed to fetch active accounts. No mail was sent.");
		return;
	}

	let sent = 0;
	let failed = 0;
	for (const account of accounts) {
		try {
			await db.collection("lom2_mail").create<MailRecord>({
				sender_name: "<gold>Jimmy The Rat",
				recipient_name: account.name,
				note: "Happy Birthday!!!",
				available: true,
				rewards: [{ type: "command", command: `ms magicitem ${item} {player}` }],
			});
			sent++;
		} catch (error) {
			failed++;
			console.error(`Failed to send ${item} to account ${account.name} (${account.uuid})`, error);
		}
	}

	console.log(`Send mail completed for ${item}: ${sent} sent, ${failed} failed`);
	await interaction.editReply(`Mail complete for ${item}. Sent: ${sent}. Failed: ${failed}.`);
}
