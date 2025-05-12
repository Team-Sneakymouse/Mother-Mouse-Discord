import { CronJob } from "cron";
import { Client, Collection, Message } from "discord.js";

export default function TimeToLive(client: Client) {
	let running = false;
	const cronJob = new CronJob("0 */15 * * * *", async () => {
		if (running) return;
		running = true;
		try {
			await cleanup();
		} catch (err) {
			console.error("Failed to delete messages", err);
		} finally {
			running = false;
		}
	});
	client.on("ready", () => {
		cronJob.start();
		console.log("TimeToLive job started");
	});

	// delete messages older than 24 hours
	async function cleanup() {
		const channel = await client.channels.fetch("800844976526590053");
		if (!channel || !channel.isTextBased() || channel.isDMBased()) return console.error("Channel not found or not a text channel");
		const toDelete = new Set<Message>();
		let latest: Message | null = null;
		while (true) {
			const messages: Collection<string, Message<true>> = await channel.messages.fetch({
				limit: 100,
				before: latest?.id,
			});
			if (messages.size === 0) break;
			for (const message of messages.values()) {
				if (
					message.createdTimestamp < Date.now() - 24 * 60 * 60 * 1000 &&
					!message.pinned &&
					!message.system &&
					!message.hasThread &&
					message.deletable
				) {
					toDelete.add(message);
					latest = message;
				} else {
					break;
				}
			}
			if (messages.size < 100) break;
			console.log(`Messages so far: ${toDelete.size}`);
		}
		if (toDelete.size === 0) return;
		const bulkDelete = [];
		for (const message of toDelete) {
			// messages younger than 2 weeks can be deleted in bulk
			if (message.createdTimestamp > Date.now() - 14 * 24 * 60 * 60 * 1000) {
				bulkDelete.push(message);
				toDelete.delete(message);
			}
		}

		console.log(`Deleting ${toDelete.size} messages from ${channel.name} (${bulkDelete.length} in bulk)`);
		await channel.bulkDelete(bulkDelete, true).catch((err) => {
			console.error("Failed to bulk delete messages", err);
		});
		let deleted = 0;
		for (const message of toDelete) {
			try {
				await message.delete();
				deleted++;
				if (deleted % 10 === 0) {
					console.log(`Deleted ${deleted} messages`);
				}
			} catch (err) {
				console.error("Failed to delete message", err);
				break;
			}
		}

		if (deleted > 0) {
			console.log(`Deleted ${deleted} messages`);
		} else {
			console.log("No messages deleted");
		}
	}
}
