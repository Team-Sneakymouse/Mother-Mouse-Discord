import { exec, spawn } from "child_process";

export default class YouTubeDL {
	init: Promise<boolean>;

	constructor() {
		this.init = new Promise((resolve, reject) => {
			exec("command -v youtube-dl", (error, stdout, stderr) => {
				if (error || stderr) resolve(false);
				resolve(true);
			});
		});
	}

	async download(url: string, updateCallback: (progress: number, eta: string) => Promise<any>): Promise<string> {
		await this.init;
		return await new Promise((resolve, reject) => {
			const dl = spawn("youtube-dl", ["--extract-audio", "--audio-format", "mp3", "-o", "ffmpeg/%(title)s.%(ext)s", url]);

			let file: string;
			dl.stdout.on("data", (data: Buffer) => {
				const match = data
					.toString()
					.match(/\[download\]\s+(\d+(?:\.\d+)?)% of (\d+\.\d+\w+) at (\d+\.\d+\w+\/s) ETA (\d+:\d+)/);
				if (match) {
					const [, progress, size, speed, eta] = match;
					if (progress !== "100%" && Math.random() < 0.4) updateCallback(parseFloat(progress), eta);
					return;
				}
				file = data.toString().split("Destination:")[1]?.trim() || file;
			});

			const errorLines: string[] = [];
			dl.stderr.on("data", (data: Buffer) => {
				console.error(`[youtube-dl] stderr: ${data}`);
				errorLines.push(data.toString());
			});

			dl.on("error", (error) => {
				console.error(`[youtube-dl] error: ${JSON.stringify(error)}`);
				reject(error.message);
			});

			dl.on("close", (code) => {
				console.log(`[youtube-dl] close: ${code}`);
				if (code !== 0) reject(errorLines.join("\n"));
				resolve(file);
			});
		});
	}
}
