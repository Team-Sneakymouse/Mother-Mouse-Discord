import { exec, spawn } from "child_process";

type DownloadOptions = {
	url: string;
	speed?: number;
	pitch?: number;
};

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

	async download(data: string | DownloadOptions, updateCallback: (progress: number, eta: string) => any): Promise<string> {
		const url = typeof data === "string" ? data : data.url;
		const speed = typeof data === "string" ? "1" : data.speed || "1";
		const pitch = typeof data === "string" ? "1" : data.pitch || "1";

		await this.init;
		return await new Promise((resolve, reject) => {
			const dl = spawn("youtube-dl", ["--extract-audio", "--audio-format", "mp3", "-o", "ffmpeg/%(title)s.%(ext)s", url]);

			let file: string;
			dl.stdout.on("data", (data: Buffer) => {
				const match = data.toString().match(/\[download\]\s+(\d+(?:\.\d+)?)% of (\d+\.\d+\w+) at (\d+\.\d+\w+\/s) ETA (\d+:\d+)/);
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

	async resample(file: string, speed: string, pitch: string, updateCallback: (progress: number, eta: string) => any): Promise<string> {
		pitch = pitch || speed;
		const newFile = file.replace(/\.mp3$/, `.${speed}x${pitch}.mp3`);
		return await new Promise((resolve, reject) => {
			const ffmpeg = spawn("ffmpeg", ["-i", file, "-filter:a", `atempo=${speed},asetrate=44100*${pitch}`, "-vn", newFile]);

			ffmpeg.stdout.on("data", (data: Buffer) => {
				const match = data.toString().match(/time=(\d+:\d+:\d+\.\d+)/);
				if (match) {
					const [, time] = match;
					const [hours, minutes, seconds] = time.split(":").map((n) => parseFloat(n));
					const progress = (hours * 60 * 60 + minutes * 60 + seconds) / 60 / 60;
					updateCallback(progress, "");
				}
			});

			const errorLines: string[] = [];
			ffmpeg.stderr.on("data", (data: Buffer) => {
				console.error(`[ffmpeg] stderr: ${data}`);
				errorLines.push(data.toString());
			});

			ffmpeg.on("error", (error) => {
				console.error(`[ffmpeg] error: ${JSON.stringify(error)}`);
				reject(error.message);
			});

			ffmpeg.on("close", (code) => {
				console.log(`[ffmpeg] close: ${code}`);
				if (code !== 0) reject(errorLines.join("\n"));
				resolve(newFile);
			});
		});
	}
}
