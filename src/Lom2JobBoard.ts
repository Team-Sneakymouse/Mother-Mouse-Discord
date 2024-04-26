import {
	Client,
	EmbedBuilder,
	TextChannel,
	ChannelType,
} from "discord.js";
import PocketBase, { Record } from 'pocketbase';
import EventSource from 'eventsource';

(global as any).EventSource = EventSource;

const jobChannelId = "1233508899630481408"

type JobData = {
	id: string;
	category: string;
	posterDisplayString: string;
	posterIconBase64: string;
	location: string;
	locationDisplayString: string
	startTime: number;
	name: string;
	description: string;
	discordEmbedIcon: string;
	discordMessageId: string;
	endTime: number;
};

function decodeBase64Image(base64String: string, fileName: string) {
	// Remove the prefix if present
	const dataStart = base64String.indexOf("base64,") + "base64,".length;
	const base64Data = base64String.substring(dataStart);

	const response: any = {};

	// Decode the base64 string
	response.data = Buffer.from(base64Data, "base64");
	response.fileName = fileName;

	return response;
}

export default function Lom2JobBoard(client: Client, pocketBase: PocketBase) {
	pocketBase.collection('lom2_listed_jobs').subscribe('*', function (e) {
		if (e.action === "create") postJob(e.record)
		else if (e.action === "update") expireJob(e.record)
	});

	function postJob(record: Record) {
		const jobChannel = client.channels.cache.get(jobChannelId) as TextChannel;

		const { id, category, posterDisplayString, posterIconBase64, location, locationDisplayString, startTime, name, description, discordEmbedIcon } = record as unknown as JobData;

		const posterIconData = decodeBase64Image(posterIconBase64, "posterIcon.png");

		if (jobChannel && jobChannel.type === ChannelType.GuildText) {
			const textChannel = jobChannel as TextChannel;

			// Use RegExp.exec to extract values from the location string
			const regex = /name=(\w+).*?x=([-\d.]+).*?y=([-\d.]+).*?z=([-\d.]+)/;
			const match = regex.exec(location);

			var url = ""
			if (match) {
				const [, world, x, y, z] = match;
				// Construct the URL
				url = `https://lords.rawb.tv/map/#?worldname=${world}&mapname=surface&zoom=4&x=${Math.round(parseFloat(x))}&y=${Math.round(parseFloat(y))}&z=${Math.round(parseFloat(z))}`;
			}

			// Create the embed builder
			const embedBuilder = new EmbedBuilder()
				.setTitle(name)
				.addFields(
					{ name: posterDisplayString, value: description }
				)
				.setColor(0x247db9)
				.setTimestamp(startTime)
				.setThumbnail("attachment://posterIcon.png")
				.setAuthor({ iconURL: discordEmbedIcon, name: category })
				.setURL(url)
				.setFooter({ text: locationDisplayString });

			// Send the message with the embed and poster icon attachment
			textChannel.send({
				embeds: [embedBuilder],
				files: [{ attachment: posterIconData.data, name: "posterIcon.png" }]
			}).then(message => {
				pocketBase.collection('lom2_listed_jobs').update(id, { discordMessageId: message.id })
			}).catch((error: any) => console.error('Error sending message:', error));
		} else {
			console.error('Invalid text channel or not a text channel.');
		}
	}

	function expireJob(record: Record) {
		const { category, posterDisplayString, locationDisplayString, startTime, description, discordEmbedIcon, discordMessageId, endTime } = record as unknown as JobData;

		if (!discordMessageId || endTime <= 0) return;

		const jobChannel = client.channels.cache.get(jobChannelId);

		if (!jobChannel || jobChannel.type !== ChannelType.GuildText) {
			console.error('Invalid text channel or not a text channel.');
			return;
		}

		const textChannel = jobChannel as TextChannel;
		textChannel.messages.fetch(discordMessageId)
			.then(message => {
				const oldEmbed = message.embeds[0];
				if (!oldEmbed) return;

				const embedBuilder = new EmbedBuilder()
					.setTitle(oldEmbed.title)
					.addFields(
						{ name: posterDisplayString, value: description }
					)
					.setColor(0x808080)
					.setTimestamp(startTime)
					.setThumbnail("attachment://posterIcon.png")
					.setAuthor({ iconURL: discordEmbedIcon, name: `${category} (Expired)` })
					.setFooter({ text: locationDisplayString });

				message.edit({ embeds: [embedBuilder] })
					.catch(error => console.error('Error editing message:', error));
			})
			.catch(error => console.error('Error fetching message:', error));
	}

}