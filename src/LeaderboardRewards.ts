import { APIEmbedImage, Client, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextChannel, TextDisplayBuilder, TextDisplayComponent } from "discord.js";
import PocketBase, { RecordModel } from "pocketbase";
import { CronJob } from "cron";

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
type MailRecord = RecordModel & {
	sender_uuid?: string;
	sender_name?: string;
	recipient_uuid?: string;
	recipient_name?: string;
	note: string;
	available: true;
	rewards: { type: "command", command: string }[];
};
type RewardRule = { start: number; end: number; spell: string };

export default function LeaderboardRewards(client: Client, db: PocketBase): LeaderboardRewardsManager {
	const manager = new LeaderboardRewardsManager(client, db);
	manager.initialize();
	return manager;
}

export class LeaderboardRewardsManager {
	client: Client;
	db: PocketBase;
	lomChannelId = "1178373136857710592";
	lomChannel: TextChannel | null = null;
	cronJob: CronJob | null = null;

	constructor(client: Client, db: PocketBase) {
		this.client = client;
		this.db = db;
	}

	initialize(): void {
		this.client.once("ready", async () => {
			this.lomChannel = (this.client.channels.cache.get(this.lomChannelId) as TextChannel) ?? null;
			if (!this.lomChannel) {
				console.error("Failed to find rawb.tv lom channel");
				return;
			}
		});
		
		// Encounters get disabled and Leaderboard is locked at 5:30 UTC, 1.5 hours before restart
		this.cronJob = new CronJob("0 31 5 * * *", () => this.runRewards(), undefined, false, "Etc/UTC");
		this.cronJob.start();
	}

	async runRewards(): Promise<void> {
		const leaderboardSettings = await this.fetchSettings();
		if (!leaderboardSettings) return;

		const date = new Date(new Date().getTime() - 7 * 60 * 60 * 1000);

		if (!this.isEnabledWeekday(leaderboardSettings, date)) return;

		const rewardRules = this.parseRules(leaderboardSettings.value.rewards);
		const leaderboards = Object.keys(rewardRules);

		const leaderboardsData = await this.fetchLeaderboardScores(leaderboards, date);
		
		await this.distributeRewards(leaderboardSettings, leaderboardsData, date);
		await this.postLeaderboardMessage("leaderboard", leaderboardsData["leaderboard"], date);
	}

	async fetchSettings(): Promise<SettingsRecord | null> {
		try {
			const settings = await this.db.collection("settings").getFirstListItem<SettingsRecord>('key = "leaderboard_rewards"').catch((e: any) => {
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

	async fetchLeaderboardScores(leaderboards: LeaderboardId[], date: Date): Promise<Record<LeaderboardId, LeaderboardRecord[]>> {
		const leaderboardsFilter = leaderboards.map(lb => `leaderboard="${lb}"`).join(" || ");
		const dateStr = date.toISOString().split('T')[0];
		const dateFilter = `date ~ "${dateStr}"`;

		return await this.db.collection("lom2_leaderboards").getFullList<LeaderboardRecord>({
			filter: `${leaderboardsFilter} && ${dateFilter} && value > 0`
		}).catch((e: any) => {
			console.error("Failed to fetch leaderboard scores", e);
			return [];
		}).then((records: LeaderboardRecord[]) => records.reduce((acc: Record<LeaderboardId, LeaderboardRecord[]>, record: LeaderboardRecord) => {
			if (!acc[record.leaderboard]) acc[record.leaderboard] = [];
			acc[record.leaderboard].push(record);
			return acc;
		}, {} as Record<LeaderboardId, LeaderboardRecord[]>));
	}

	async distributeRewards(leaderboardSettings: SettingsRecord, leaderboardsData: Record<LeaderboardId, LeaderboardRecord[]>, date: Date): Promise<void> {
		const rewardRules = this.parseRules(leaderboardSettings.value.rewards);
		const leaderboards = Object.keys(rewardRules);
		let mailsSent = Object.fromEntries(leaderboards.map(lb => [lb, 0]));
		
		const weekday = date.toLocaleString("en-US", { weekday: "long" });
		for (const [leaderboard, scores] of Object.entries(leaderboardsData)) {
			const rules = rewardRules[leaderboard];
			if (!rules || rules.size === 0) continue;
			
			scores.sort((a, b) => b.value - a.value);
			for (let i = 0; i < scores.length; i++) {
				const rank = i + 1;
				const score = scores[i];

				const rewardsCommands = this.getRewardCommands(rules, rank);
				if (rewardsCommands.length === 0) continue;

				await this.sendRewardMail(score, leaderboard, rank, weekday, rewardsCommands, mailsSent);
			}
			console.log(`Sent a total of ${mailsSent[leaderboard]} mails for leaderboard ${leaderboard}`);
		}
	}

	getRewardCommands(rules: Set<RewardRule>, rank: number): string[] {
		const commands: string[] = [];
		for (const rule of rules) {
			if (rank >= rule.start && rank <= rule.end) {
				commands.push(`ms cast as {player} ${rule.spell}`);
			}
		}
		return commands;
	}

	async sendRewardMail(score: LeaderboardRecord, leaderboard: LeaderboardId, rank: number, weekday: string, rewardsCommands: string[], mailsSent: Record<LeaderboardId, number>): Promise<void> {
		const result = await this.db.collection("lom2_mail").create<MailRecord>({
			sender_name: "<gold>Grand Paladin Order</gold>",
			sender_uuid: "",
			recipient_name: "",
			recipient_uuid: score.account,
			available: true,
			note: `<gold>Congratulations!</gold>\nYou placed <yellow>${this.getOrdinal(rank)}</yellow> on ${weekday}'s leaderboard\nwith your score of <white>${Intl.NumberFormat('en-US').format(score.value)}</white>.`,
			rewards: rewardsCommands.map(command => ({ type: "command", command })),
		}).catch((e: any) => {
			console.error(`Failed to send reward mail to ${score.account} for leaderboard ${leaderboard} with rank ${rank} and score ${score.value}`, e);
			return null;
		});
		if (!result) return console.error(`Failed to send reward mail to ${score.account} for leaderboard ${leaderboard} with rank ${rank} and score ${score.value}`);
		mailsSent[leaderboard]++;
		console.log(`Sent reward mail to ${score.account} for leaderboard ${leaderboard} with rank ${rank} and score ${score.value}`);
	}

	async postLeaderboardMessage(leaderboard: LeaderboardId, scores: LeaderboardRecord[], date: Date): Promise<void> {
		if (leaderboard !== "leaderboard" || scores.length === 0) return console.error("No scores to post for leaderboard message");
		if (!this.lomChannel) return console.error("Lom channel not found, cannot post leaderboard message");

		const weekday = date.toLocaleString("en-US", { weekday: "long" });
		const branding = this.getBranding(weekday);
		if (!branding) return console.error(`No branding found for weekday ${weekday}, cannot post leaderboard message`);

		const content = this.formatLeaderboardContent(scores);
		const attachmentBuffer = await this.fetchBrandingImage(branding.image);

		const dateStr = date.toISOString().split('T')[0];
		const imageName = `leaderboard_${dateStr}.png`;
		const mediaItemUrl = attachmentBuffer ? `attachment://${imageName}` : branding.image;

		await this.lomChannel.send({
			flags: MessageFlags.IsComponentsV2,
			components: [
				new TextDisplayBuilder().setContent(`# Leaderboard ${dateStr}`),
				new ContainerBuilder()
					.setAccentColor(branding.color)
					.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
						new MediaGalleryItemBuilder().setURL(mediaItemUrl).setDescription(branding.title)
					))
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(content)
					)
			],
			files: attachmentBuffer ? [{ attachment: attachmentBuffer, name: imageName }] : []
		});
	}

	getBranding(weekday: string): { title: string; color: number; image: string } | null {
		const branding: Record<string, { title: string; color: number; image: string }> = {
			"Monday": { title: "Mining Monday", color: 0x727679, image: "https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_monday.png?raw=true" },
			"Tuesday": { title: "Turbo Tuesday", color: 0x3498DB, image: "https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_tuesday.png?raw=true" },
			"Wednesday": { title: "Wizardry Wednesday", color: 0xA161BC, image: "https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_wednesday.png?raw=true" },
			"Friday": { title: "Fishing Friday", color: 0x91C5F2, image: "https://github.com/Team-Sneakymouse/resourcepacks/blob/split/entities/assets/lom/textures/item/entities/leaderboards/leaderboard_friday.png?raw=true" },
		};
		return branding[weekday] ?? null;
	}

	formatLeaderboardContent(scores: LeaderboardRecord[]): string {
		return scores
			.sort((a, b) => b.value - a.value)
			.slice(0, 16)
			.map((score, i) => i === 0 
				? `${i}. **${score.name}: ${Intl.NumberFormat('en-US').format(score.value)}**` 
				: `${i}. ${score.name}: **${Intl.NumberFormat('en-US').format(score.value)}**`
			)
			.join("\n");
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

	parseRules(config: SettingsRecord["value"]["rewards"]): Record<LeaderboardId, Set<RewardRule>> {
		const rules: Record<LeaderboardId, Set<RewardRule>> = {};
		for (const leaderboard in config) {
			for (const [range, spell] of Object.entries(config[leaderboard] || {})) {
				let start = 0, end = 0;
				try {
					if (range.includes("-")) {
						[start, end] = range.split("-").map(s => parseInt(s.trim()));
					} else if (range.endsWith("+")) {
						start = parseInt(range.slice(0, -1).trim());
						end = Number.MAX_SAFE_INTEGER;
					} else {
						start = end = parseInt(range.trim());
					}
				} catch (e) {
					console.error(`Failed to parse range "${range}" for leaderboard "${leaderboard}" with spell "${spell}"`, e);
					continue;
				}
				if (Number.isNaN(start) || Number.isNaN(end)) {
					console.error(`Parsed invalid range "${range}" for leaderboard "${leaderboard}" with spell "${spell}"`);
					continue;
				}
				if (!rules[leaderboard]) rules[leaderboard] = new Set();
				rules[leaderboard].add({ start, end, spell });
			}
		}
		return rules;
	}

	getOrdinal(i: number): string {
		const suffixes = ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"];
		const absI = Math.abs(i);
		const mod100 = absI % 100;
		const mod10 = absI % 10;
		if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
		return `${i}${suffixes[mod10]}`;
	}
}