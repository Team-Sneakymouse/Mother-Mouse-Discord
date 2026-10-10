import { execFile, spawn } from "child_process";

type DownloadOptions = {
	url: string;
	speed?: number;
	pitch?: number;
};

export default class YouTubeDL {
	init: Promise<boolean>;

	constructor() {
		this.init = new Promise((resolve, reject) => {
			execFile("yt-dlp", ["--ignore-config", "--version"], (error) => resolve(!error));
		});
	}

	async download(data: string | DownloadOptions, updateCallback: (progress: number, eta: string) => any): Promise<string> {
		const url = typeof data === "string" ? data : data.url;
		const speed = typeof data === "string" ? "1" : data.speed || "1";
		const pitch = typeof data === "string" ? "1" : data.pitch || "1";

		if (!(await this.init)) throw "yt-dlp is unavailable. Rebuild the downloader image or follow docs/youtube-downloader.md for local setup.";
		return await new Promise((resolve, reject) => {
			const dl = spawn("yt-dlp", [
				"--ignore-config", "--js-runtimes", "node", "--newline", "--progress", "--no-simulate",
				"--extract-audio", "--audio-format", "mp3", "--print", "after_move:%(filepath)j",
				"-o", "ffmpeg/%(title)s.%(ext)s",
				...(process.env.YTDLP_COOKIES_FILE ? ["--cookies", process.env.YTDLP_COOKIES_FILE] : []),
				"--", url,
			]);

			let file: string;
			let pending = "";
			const readLine = (line: string) => {
				const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%.*? ETA (\S+)/);
				if (match) {
					const [, progress, eta] = match;
					if (progress !== "100" && Math.random() < 0.4) updateCallback(parseFloat(progress), eta);
				}
				try {
					const path: unknown = JSON.parse(line);
					if (typeof path === "string") file = path;
				} catch { /* Ignore yt-dlp's human-readable status lines. */ }
			};
			dl.stdout.setEncoding("utf8");
			dl.stdout.on("data", (data: string) => {
				pending += data;
				const lines = pending.split("\n");
				pending = lines.pop()!;
				lines.forEach(readLine);
			});
			dl.stdout.on("end", () => { if (pending) readLine(pending); });

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
				if (code !== 0) {
					const diagnostic = errorLines.join("\n");
					if (/sign in to confirm|not a bot/i.test(diagnostic)) {
						return reject("YouTube requires bot verification. Ask an operator to configure YTDLP_COOKIES_FILE with an authorized cookie file (see docs/youtube-downloader.md). Updating yt-dlp alone cannot bypass this check.");
					}
					return reject(diagnostic.trim() || `yt-dlp failed with exit code ${code}. Check the downloader installation and network access.`);
				}
				if (!file) return reject("yt-dlp did not report a final audio file. Check the downloader installation.");
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
