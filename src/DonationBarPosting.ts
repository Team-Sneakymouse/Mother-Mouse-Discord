import { AttachmentBuilder, type Client, type Message } from "discord.js";
import EventSource from "eventsource";
import type PocketBase from "pocketbase";

import { type DonationBarRecord, renderDonationBarWebp } from "./utils/DonationBarRenderer.js";

(global as any).EventSource = EventSource;

const donationBarRecordId = "0nnibthhphxr46q";
const donationBarChannelId = "806994887773519913";
const donationBarAttachmentName = "donation-bar.webp";

function normalizeContent(content: string): string {
	return content.replace(/\u00A0/g, "").trim();
}

function isImageOnlyMessage(message: Message, botUserId?: string): boolean {
	if (message.author.id !== botUserId) return false;
	if (normalizeContent(message.content).length > 0) return false;
	if (message.embeds.length > 0) return false;
	if (message.attachments.size !== 1) return false;

	const attachment = message.attachments.first();
	if (!attachment) return false;

	const contentType = attachment.contentType ?? "";
	const looksLikeImage = contentType.startsWith("image/") || /\.(png|webp|gif|jpe?g)$/i.test(attachment.name ?? "");

	return looksLikeImage;
}

export default function DonationBarPosting(client: Client, pocketbase: PocketBase) {
	const readyPromise = client.isReady() ? Promise.resolve() : new Promise<void>((resolve) => client.once("clientReady", () => resolve()));
	let syncQueue = Promise.resolve();

	client.once("clientReady", () => {
		syncQueue = syncQueue
			.catch((error) => console.error("DonationBarPosting queue error:", error))
			.then(() => syncDonationBar())
			.catch((error) => console.error("DonationBarPosting sync error:", error));

		pocketbase.collection("donationbars").subscribe<DonationBarRecord>(donationBarRecordId, (event) => {
			console.log(`Donation bar update: ${event.record.id} (${event.action})`);
			if (event.action !== "update") return;

			syncQueue = syncQueue
				.catch((error) => console.error("DonationBarPosting queue error:", error))
				.then(() => syncDonationBar(event.record))
				.catch((error) => console.error("DonationBarPosting sync error:", error));
		});
	});

	async function syncDonationBar(record?: DonationBarRecord) {
		await readyPromise;

		const donationBar = record ?? (await pocketbase.collection("donationbars").getOne<DonationBarRecord>(donationBarRecordId));
		// if (!donationBar.enabled) return;

		const channel = client.channels.cache.get(donationBarChannelId) ?? (await client.channels.fetch(donationBarChannelId));
		if (!channel || channel.isDMBased() || !channel.isTextBased()) {
			console.error(`Channel ${donationBarChannelId} is not a text channel`);
			return;
		}

		const messages = await channel.messages.fetch({ limit: 20 });
		const existingMessage = [...messages.values()]
			.sort((a, b) => b.createdTimestamp - a.createdTimestamp)
			.find((message) => isImageOnlyMessage(message, client.user?.id));

		const image = await renderDonationBarWebp(donationBar);
		const file = new AttachmentBuilder(image, {
			name: donationBarAttachmentName,
		});

		if (existingMessage) {
			await existingMessage.edit({
				content: "",
				attachments: [],
				files: [file],
			});
			return;
		}

		await channel.send({
			files: [file],
		});
	}
}
