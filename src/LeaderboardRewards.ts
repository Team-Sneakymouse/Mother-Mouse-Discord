import {
	APIEmbedImage,
	Client,
	ContainerBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageCreateOptions,
	MessageEditOptions,
	MessageFlags,
	SlashCommandBuilder,
	TextChannel,
	TextDisplayBuilder,
	TextDisplayComponent,
} from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
import { CronJob } from "cron";
import { formatLeaderboardContent, planLeaderboardRewards, type PlannedRewardMail, type RewardParsingDiagnostic } from "./LeaderboardRewardPlanning.js";
import { resendStatement, SourceKeyReusedError, type MailSender } from "./utils/SneakyMail.js";

export const data = [new SlashCommandBuilder().setName("leaderboard").setDescription("Display the current leaderboard")];

type LeaderboardId = string;
type RangeString = string;
type SpellName = string;
type SettingsRecord = RecordModel & {
	key: string;
	value: {
		weekdays: ("Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday")[];
		rewards: Record<LeaderboardId, Record<RangeString, SpellName>>;
	};
};
type LeaderboardRecord = RecordModel & {
	leaderboard: LeaderboardId;
	date: string; // ISO date string (yyyy-MM-dd hh:mm:ss.fffZ)
	account: string;
	name: string;
	value: number;
};

/** Settings and scores come from PocketBase; reward mail goes to SneakyMail's PostgreSQL table. */
export default function LeaderboardRewards(client: Client, db: PocketBase, mail: MailSender | null): LeaderboardRewardsManager {
	const manager = new LeaderboardRewardsManager(client, db, mail);
	manager.initialize();
	return manager;
}

export class LeaderboardRewardsManager {
	client: Client;
	db: PocketBase;
	mail: MailSender | null;
	lomChannelId = "1178373136857710592";
	lomChannel: TextChannel | null = null;
	cronJob: CronJob | null = null;

	constructor(client: Client, db: PocketBase, mail: MailSender | null) {
		this.client = client;
		this.db = db;
		this.mail = mail;
	}

	initialize(): void {
		this.client.once("clientReady", async () => {
			this.lomChannel = (this.client.channels.cache.get(this.lomChannelId) as TextChannel) ?? null;
			if (!this.lomChannel) {
				console.error("Failed to find rawb.tv lom channel");
				return;
			}
		});

		this.client.on("interactionCreate", async (interaction) => {
			if (interaction.isChatInputCommand() && interaction.commandName === "leaderboard") {
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const date = this.getLeaderboardDate();
				if (!this.getBranding(date.toLocaleString("en-US", { weekday: "long" }))) {
					await interaction.editReply("No leaderboard available today");
					return;
				}
				const leaderboardData = await this.fetchLeaderboardScores(["leaderboard"], date);
				const data = await this.getLeaderboardRewardsMessageData("leaderboard", leaderboardData["leaderboard"] || [], date);
				if (this.lomChannel && data) await interaction.editReply(data);
			}
		});

		// Server restarts at 7:00 UTC; distribute rewards for the completed game day
		this.cronJob = new CronJob("0 0 7 * * *", () => this.runRewards(), undefined, false, "Etc/UTC");
		this.cronJob.start();
	}

	/** Game day ends at 07:00 UTC; subtract just over 7h so the boundary falls on the completed day. */
	getLeaderboardDate(now = Date.now()): Date {
		return new Date(now - 7 * 60 * 60 * 1000 - 1000);
	}

	async runRewards(): Promise<void> {
		const leaderboardSettings = await this.fetchSettings();
		if (!leaderboardSettings) return;

		const date = this.getLeaderboardDate();

		if (!this.isEnabledWeekday(leaderboardSettings, date)) return;

		const eligibility = planLeaderboardRewards({}, leaderboardSettings.value.rewards, date.toLocaleString("en-US", { weekday: "long" }), this.gameDay(date));
		this.logParsingDiagnostics(eligibility.diagnostics);
		const leaderboardsData = await this.fetchLeaderboardScores(eligibility.eligibleLeaderboards, date);

		await this.distributeRewards(leaderboardSettings, leaderboardsData, date);
		await this.postLeaderboardMessage("leaderboard", leaderboardsData["leaderboard"], date);
	}

	async fetchSettings(): Promise<SettingsRecord | null> {
		try {
			const settings = await this.db
				.collection("settings")
				.getFirstListItem<SettingsRecord>('key = "leaderboard_rewards"')
				.catch((e: any) => {
					if (e.status === 404) return null;
					throw e;
				});
			return settings;
		} catch (error) {
			console.error("Failed to fetch leaderboard rewards settings", error);
			return null;
		}
	}

	isEnabledWeekday(settings: SettingsRecord, date: Date): boolean {
		const weekday = date.toLocaleString("en-US", { weekday: "long" });
		const enabledWeekdays = settings.value?.weekdays;
		if (!enabledWeekdays || !Array.isArray(enabledWeekdays)) {
			console.error("Invalid or missing 'weekdays' in leaderboard rewards settings");
			return false;
		}
		if (!enabledWeekdays.includes(weekday as any)) {
			console.log(`Leaderboard rewards not enabled for ${weekday}`);
			return false;
		}
		return true;
	}

	/** The yyyy-mm-dd that the day's scores are stored under. */
	gameDay(date: Date): string {
		return date.toISOString().split("T")[0];
	}

	async fetchLeaderboardScores(leaderboards: LeaderboardId[], date: Date): Promise<Record<LeaderboardId, LeaderboardRecord[]>> {
		if (leaderboards.length === 0) return {};
		const leaderboardsFilter = leaderboards.map((lb) => `leaderboard="${lb}"`).join(" || ");
		const dateStr = this.gameDay(date);
		const dateFilter = `date ~ "${dateStr}"`;

		return await this.db
			.collection("lom2_leaderboards")
			.getFullList<LeaderboardRecord>({
				// PocketBase binds && tighter than ||, so the leaderboard alternatives need their own group.
				filter: `(${leaderboardsFilter}) && ${dateFilter} && value > 0`,
			})
			.catch((e: any) => {
				console.error("Failed to fetch leaderboard scores", e);
				return [];
			})
			.then((records: LeaderboardRecord[]) =>
				records.reduce(
					(acc: Record<LeaderboardId, LeaderboardRecord[]>, record: LeaderboardRecord) => {
						if (!acc[record.leaderboard]) acc[record.leaderboard] = [];
						acc[record.leaderboard].push(record);
						return acc;
					},
					{} as Record<LeaderboardId, LeaderboardRecord[]>,
				),
			);
	}

	async distributeRewards(leaderboardSettings: SettingsRecord, leaderboardsData: Record<LeaderboardId, LeaderboardRecord[]>, date: Date): Promise<void> {
		const weekday = date.toLocaleString("en-US", { weekday: "long" });
		const plan = planLeaderboardRewards(leaderboardsData, leaderboardSettings.value.rewards, weekday, this.gameDay(date));
		this.logParsingDiagnostics(plan.diagnostics);
		const mailSender = this.mail;
		if (!mailSender) {
			console.error("LeaderboardRewards: no PostgreSQL database (PGHOST unset); no reward mail sent");
			for (const { payload } of plan.mails) console.error(`Not sent: source key ${payload.sourceKey}. Resend by hand: ${resendStatement(payload)}`);
			return;
		}
		const mailsByLeaderboard = new Map<string, PlannedRewardMail[]>(plan.eligibleLeaderboards.map((leaderboard) => [leaderboard, []]));
		for (const mail of plan.mails) mailsByLeaderboard.get(mail.metadata.leaderboard)!.push(mail);
		for (const [leaderboard] of Object.entries(leaderboardsData)) {
			const mails = mailsByLeaderboard.get(leaderboard);
			if (!mails) continue;
			let mailsSent = 0;
			for (const mail of mails) {
				if (await this.sendRewardMail(mailSender, mail)) mailsSent++;
			}
			console.log(`Sent a total of ${mailsSent} mails for leaderboard ${leaderboard}`);
		}
	}

	private logParsingDiagnostics(diagnostics: RewardParsingDiagnostic[]): void {
		for (const diagnostic of diagnostics) {
			const { range, leaderboard, spell } = diagnostic;
			if (diagnostic.kind === "parse-error") {
				console.error(`Failed to parse range "${range}" for leaderboard "${leaderboard}" with spell "${spell}"`, diagnostic.error);
			} else {
				console.error(`Parsed invalid range "${range}" for leaderboard "${leaderboard}" with spell "${spell}"`);
			}
		}
	}

	private async sendRewardMail(sender: MailSender, mail: PlannedRewardMail): Promise<boolean> {
		const { leaderboard, account, rank, score } = mail.metadata;
		const what = `reward mail to ${account} for leaderboard ${leaderboard} with rank ${rank} and score ${score}`;
		try {
			await sender.send(mail.payload);
		} catch (e) {
			// A reused key means this account already got different mail for this leaderboard and day: not sent again.
			// Any other failure may come after the commit (lost reply), so the mail may exist: resending with the key is safe.
			const reason =
				e instanceof SourceKeyReusedError ? ": the key already names a mail with different content" : `; it may already exist. Resend by hand (safe, same key): ${resendStatement(mail.payload)}`;
			console.error(`${e instanceof SourceKeyReusedError ? "Failed to send" : "Could not confirm"} ${what} (source key ${mail.payload.sourceKey})${reason}`, e);
			return false;
		}
		console.log(`Sent ${what}`);
		return true;
	}

	private async getLeaderboardRewardsMessageData(
		leaderboard: LeaderboardId,
		scores: LeaderboardRecord[],
		date: Date,
	): Promise<(MessageCreateOptions & MessageEditOptions) | void> {
		if (leaderboard !== "leaderboard" || scores.length === 0) return console.error("No scores to post for leaderboard message");
		if (!this.lomChannel) return console.error("Lom channel not found, cannot post leaderboard message");

		const weekday = date.toLocaleString("en-US", { weekday: "long" });
		const branding = this.getBranding(weekday);
		if (!branding) return console.error(`No branding found for weekday ${weekday}, cannot post leaderboard message`);

		const content = this.formatLeaderboardContent(scores);
		const attachmentBuffer = await this.fetchBrandingImage(branding.image);

		const dateStr = date.toISOString().split("T")[0];
		const imageName = `leaderboard_${dateStr}.png`;
		const mediaItemUrl = attachmentBuffer ? `attachment://${imageName}` : branding.image;

		return {
			flags: MessageFlags.IsComponentsV2,
			components: [
				new TextDisplayBuilder().setContent(`# Leaderboard ${dateStr}`),
				new ContainerBuilder()
					.setAccentColor(branding.color)
					.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(mediaItemUrl).setDescription(branding.title)))
					.addTextDisplayComponents(new TextDisplayBuilder().setContent(content)),
			],
			files: attachmentBuffer ? [{ attachment: attachmentBuffer, name: imageName }] : [],
		};
	}

	async postLeaderboardMessage(leaderboard: LeaderboardId, scores: LeaderboardRecord[], date: Date): Promise<void> {
		const data = await this.getLeaderboardRewardsMessageData(leaderboard, scores, date);
		if (this.lomChannel && data) await this.lomChannel.send(data);
	}

	getBranding(weekday: string): { title: string; color: number; image: string } | null {
		const branding: Record<string, { title: string; color: number; image: string }> = {
			Monday: {
				title: "Mining Monday",
				color: 0x727679,
				image:
					"https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_monday.png?raw=true",
			},
			Tuesday: {
				title: "Turbo Tuesday",
				color: 0x3498db,
				image:
					"https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_tuesday.png?raw=true",
			},
			Wednesday: {
				title: "Wizardry Wednesday",
				color: 0xa161bc,
				image:
					"https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_wednesday.png?raw=true",
			},
			Friday: {
				title: "Fishing Friday",
				color: 0x91c5f2,
				image:
					"https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_friday.png?raw=true",
			},
		};
		return branding[weekday] ?? null;
	}

	formatLeaderboardContent(scores: LeaderboardRecord[]): string {
		return formatLeaderboardContent(scores);
	}

	async fetchBrandingImage(imageUrl: string): Promise<Buffer | null> {
		try {
			const res = await fetch(imageUrl);
			if (res.ok) return Buffer.from(await res.arrayBuffer());
			console.error(`Failed to fetch branding image: ${imageUrl} status=${res.status}`);
			return null;
		} catch (e) {
			console.error(`Error fetching branding image ${imageUrl}:`, e);
			return null;
		}
	}
}
