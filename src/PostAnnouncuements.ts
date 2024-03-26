import { APIEmbedImage, Client, TextChannel } from "discord.js";
import Parser from "rss-parser";
import PocketBase, { Record as PBRecord } from "pocketbase";
import { CronJob } from "cron";

type TwitterPost = {
	creator: string;
	title: string;
	link: string;
	pubDate: string;
	content: string;
	contentSnippet: string;
	guid: string;
	isoDate: string;
};
export default async function PostAnnouncements(client: Client, rss: Parser, db: PocketBase) {
	// https://github.com/zedeus/nitter/wiki/Instances
	const nitterHost = "https://nitter.poast.org";
	const feedUrl = `${nitterHost}/ms_dvil/rss`;
	let lastTweetId: string | null = null;
	let lastTweetRecord: (PBRecord & { value: [string] }) | null = null;
	let feedChannel: TextChannel | null = null;

	client.once("ready", async () => {
		lastTweetRecord = await db
			.collection("settings")
			.getFirstListItem<PBRecord & { value: [string] }>('key="rss_msdvil_last_tweet"')
			.catch((e) => {
				if (e.status === 404) return null;
				throw e;
			});
		lastTweetId = lastTweetRecord?.value[0] ?? null;
		console.log("Last tweet ID:", lastTweetId);

		feedChannel = (client.channels.cache.get("1222124483700068362") as TextChannel) ?? null;
		// feedChannel = (client.channels.cache.get("155020885521203200") as TextChannel) ?? null;
		if (!feedChannel) {
			console.error("Failed to find feed channel");
			return;
		}
		await workTwitterMsdvil();
	});

	new CronJob("0 */10 * * * *", workTwitterMsdvil).start();

	async function workTwitterMsdvil() {
		console.log("Checking MsDVil's Twitter feed");
		const feed = await (rss as Parser<{}, TwitterPost>).parseURL(feedUrl).catch((e) => {
			console.error("Failed to fetch RSS feed", e);
			const dani = client.users.cache.get("155020885521203200");
			if (dani) dani.send("Failed to fetch RSS feed: ```\n" + e + "\n```");
			return null;
		});
		if (!feed) return;
		if (!lastTweetId) {
			console.log("No last tweet ID found, setting to latest tweet");
			const url = new URL(feed.items[0].link);
			lastTweetId = url.pathname.split("/").pop()!;
			lastTweetRecord = await db.collection("settings").create({ key: "rss_msdvil_last_tweet", value: [lastTweetId] });
		}

		const unseenPosts: TwitterPost[] = [];
		let tweetId = "";
		let currentTweetId = lastTweetId;
		for (let i = 0; i < feed.items.length; i++) {
			const post = feed.items[i];
			const url = new URL(post.link);
			tweetId = url.pathname.split("/").pop()!;
			if (i === 0) currentTweetId = tweetId;
			if (tweetId === lastTweetId) break;
			unseenPosts.push(post);
		}
		console.log(`Found ${unseenPosts.length}/${feed.items.length} new tweets`);
		await db.collection("settings").update(lastTweetRecord!.id, { value: [currentTweetId] });
		lastTweetId = currentTweetId;
		console.log("Updated last tweet ID to", currentTweetId);

		for (const post of unseenPosts) {
			const isReply = post.title.startsWith(`R to @${feed.title?.split(" / ")[1]}: `);
			const isRetweet = post.title.startsWith(`RT by ${feed.title?.split(" / ")[1]}: `);
			const isQuote = post.content.includes('<a href="' + nitterHost);
			if (isReply || isRetweet || isQuote) return;

			const username = post.creator.substring(1);
			const imageTags = post.content.match(/<img src="([^"]+)"/g);
			const imageUrls = (imageTags ?? []).map((imageUrl) => imageUrl.substring(10, imageUrl.length - 1)); // <img src="https://nitter.poast.org/pic/orig/media%2F<IMAGE_ID>.jpg"
			const imageNames = imageUrls.map((url) => url.split("%2F").pop()!);
			const twitterUrls = imageNames.map((imageName) => `https://pbs.twimg.com/media/${imageName}?name=orig`);
			const images: APIEmbedImage[] | [undefined] = twitterUrls.length > 0 ? twitterUrls.map((url) => ({ url })) : [undefined];

			const postId = post.link.match(/status\/(\d+)/)![1];
			const postLink = `https://twitter.com/${username}/status/${postId}`;

			await feedChannel?.send({
				content: `Hey @everyone, **MsDVil** just tweeted:\n<${postLink}>`,
				embeds: images.map((image) => ({
					author: {
						name: feed.title?.includes(post.creator) ? feed.title?.split(" / ")[0] : post.creator,
						url: `https://twitter.com/${username}`,
						icon_url: `https://unavatar.io/twitter/${username}`,
					},
					description: post.contentSnippet,
					url: post.link,
					image,
					color: 0x08a0e9,
					footer: {
						icon_url:
							"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Logo_of_Twitter.svg/292px-Logo_of_Twitter.svg.png",
						text: "The Platform Formerly Known As Twitter",
					},
					timestamp: new Date(post.isoDate).toISOString(),
				})),
			});
			console.log("Posted tweet", images);
		}
	}
}
