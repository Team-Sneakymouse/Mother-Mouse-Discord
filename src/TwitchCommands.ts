import { Client } from "discord.js";
export default function TwitchCommands(client: Client) {
	client.on("messageCreate", async (message): Promise<any> => {
		const args = message.content.split(" ");
		// !beard
		if (args[0] === "!beard") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`${name} has a pretty amazing beard <:meow:743957972031504384>`);
		}

		// !besthat
		if (args[0] === "!besthat") {
			return await message.channel.send(`The best hat is obviously the pinabble hat`);
		}

		// !bless
		if (args[0] === "!bless") {
			return await message.channel.send("Bless you, Megan! <:bless:631970567817527340>");
		}

		// !chatsfavorite
		if (["!chatsfavorite", "!chatsfavourite"].includes(args[0])) {
			return await message.channel.send(`It's Megan! <:1robYAY:652994005189132299>`);
		}

		// !crabby
		if (args[0] === "!crabby") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`I love that ${name}`);
		}

		// !deathstare
		if (args[0] === "!deathstare") {
			return await message.channel.send(
				`Slow down, dear~ <:robMonica:805582450377097236>\nhttps://cdn.discordapp.com/attachments/391355330744942594/807143080276131850/deathstare.mp4`
			);
		}

		// !discord
		if (["!discord", "!d"].includes(args[0])) {
			return await message.channel.send(
				`If you're a rawb sub, you can now join the Discord. Check your connections in non-mobile Discord if your Twitch is linked.`
			);
		}

		// !dorky
		if (args[0] === "!dorky") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`I've never seen that ${name} before <:ohNo:518193208878956584>`);
		}

		// !five
		if (["!five", "!5"].includes(args[0])) {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`We need five ${name}. More than that is a waste.`);
		}

		// !galar
		if (args[0] === "!galar") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`${name} isn't even in Galar...`);
		}

		// !gas
		if (args[0] === "!gas") {
			return await message.channel.send(`gas isn't free? <:ohNo:518193208878956584>`);
		}

		// !maris
		if (args[0] === "!maris") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`I wish that ${name} was me <:lewd:743957971272466492>`);
		}

		// medal
		if (args[0] === "!medal") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`${name} I've been waiting for you! You're doing terrific! Here's a new medal!`);
		}

		// !megan
		if (args[0] === "!megan") {
			return await message.channel.send(`Megan is the best! <:1robYAY:652994005189132299>`);
		}

		// !spin
		if (args[0] === "!spin") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`SPIN THAT ${name}!`);
		}

		// !tudd
		if (args[0] === "!tudd") {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`I APPRECIATE ${name} <:love:631970630505332797>`);
		}

		// !zoo
		if (["!zooloo", "!zoo"].includes(args[0])) {
			args.shift();
			let name = args.join(" ") || message.author.toString();
			return await message.channel.send(`${name} makes me so moist! <:robMyGoodness:805582450498600970>`);
		}
	});
}
