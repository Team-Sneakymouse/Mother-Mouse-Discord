import { Client, ThreadChannel } from "discord.js";
import PocketBase, { BaseModel } from "pocketbase";
import io from "socket.io-client";

const SOCKET_URL = 'https://realtime.streamelements.com';
const DEBUG_CHANNEL = "1443851800217129040";
const INFO_CHANNEL = "1443150934686433393";

type EventMappingRecord = BaseModel & {
	text: string;
	broadcast: boolean;
};

export default function SEPromo(client: Client, pocketbase: PocketBase) {
	const STREAMELEMENTS_API_KEY = process.env["STREAMELEMENTS_API_KEY"];
	if (!STREAMELEMENTS_API_KEY) {
		throw new Error("Missing StreamElements credentials");
	}

	let debugChannel: ThreadChannel|null = null;
	let infoChannel: ThreadChannel|null = null;
	client.once("ready", async () => {
		debugChannel = await client.channels.fetch(DEBUG_CHANNEL) as ThreadChannel;
		infoChannel = await client.channels.fetch(INFO_CHANNEL) as ThreadChannel;
	});

	const socket = io(SOCKET_URL, {
		transports: ['websocket'],
	});
	
	socket.on('connect', () => {
		console.log('Connected to StreamElements Realtime API. Authenticating...');
		socket.emit('authenticate', {
			method: 'apikey',
			token: STREAMELEMENTS_API_KEY,
		});
	});
	socket.on('authenticated', (data) => {
		console.log(`Authenticated with StreamElements Realtime API (channel ${data.channelId}). Subscribing to events...`);

		const room = `partner-integrations::${data.channelId}`;
		socket.emit('subscribe', { room, reconnect: true }, (err: any) => {
			if (err) {
				console.error('Error subscribing to room:', err);
				return;
			}
			console.log(`Subscribed to room: ${room}`);
		});
	});
	socket.on('unauthorized', (err) => {
		console.error('Failed to authenticate with StreamElements Realtime API:', err);
	});
	socket.on('disconnect', () => {
		console.log('Disconnected from StreamElements Realtime API');
	});
	socket.on('error', (err) => {
		console.error('StreamElements Realtime API error:', err);
	});

	socket.on('partner-integrations:event', async (data: any) => {
		const eventCode = data.event || (data.data && data.data.event);
		const username = data.username || (data.data && data.data.username);

		const eventMapping = await pocketbase.collection<EventMappingRecord>('msd_event_mapping').getFirstListItem(`event="${eventCode}"`)
			.catch(e => {
				if (e.status === 404) {
					return {
						text: eventCode,
						broadcast: false,
					} as EventMappingRecord;
				}
				throw e;
			});

		if (debugChannel)
			debugChannel.send(`${username} achieved: ${eventMapping.text}:\`\`\`json\n${JSON.stringify(data, null, 2)}\`\`\``);

		if (infoChannel && eventMapping.broadcast)
			await infoChannel.send(`**${username}** has achieved **${eventMapping.text}**`);
	});
}
