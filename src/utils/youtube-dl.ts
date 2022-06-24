import { exec } from "child_process";

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

	download(url: string) {
		return new Promise(async (resolve, reject) => {
			await this.init;
			exec(`youtube-dl --extract-audio --audio-format mp3 -o "yt/%(title)s.%(ext)s" ${url}`, (error, stdout, stderr) => {
				if (error) return reject(error);
				if (stderr) return reject(stderr);
				resolve(stdout);
			});
		});
	}
}
