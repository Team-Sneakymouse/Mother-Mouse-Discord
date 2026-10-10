import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YouTubeDL from "../src/utils/youtube-dl.ts";

async function withDownloader(body: (dir: string) => Promise<void>, script: string) {
	const dir = mkdtempSync(join(tmpdir(), "youtube-dl-test-"));
	const oldPath = process.env.PATH;
	const oldCookies = process.env.YTDLP_COOKIES_FILE;
	writeFileSync(join(dir, "yt-dlp"), `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log('2026.08.19'); process.exit(0); }\n${script}`, { mode: 0o755 });
	symlinkSync(execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim(), join(dir, "node"));
	process.env.PATH = dir;
	delete process.env.YTDLP_COOKIES_FILE;
	try {
		await body(dir);
	} finally {
		process.env.PATH = oldPath;
		if (oldCookies === undefined) delete process.env.YTDLP_COOKIES_FILE;
		else process.env.YTDLP_COOKIES_FILE = oldCookies;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("reports silent subprocess failures with an exit code", async () => {
	await withDownloader(async () => {
		await assert.rejects(new YouTubeDL().download("https://example.com/video", () => {}), (error: unknown) => {
			assert.match(String(error), /yt-dlp.*exit code 2/i);
			return true;
		});
	}, "process.exit(2);");
});

test("parses split UTF-8 output and progress while forcing progress with --print", async () => {
	const oldRandom = Math.random;
	Math.random = () => 0;
	try {
		await withDownloader(async (dir) => {
			const updates: [number, string][] = [];
			assert.equal(await new YouTubeDL().download("https://example.com/video", (progress, eta) => updates.push([progress, eta])), "ffmpeg/Mäuse.mp3");
			assert.deepEqual(updates, [[12.5, "00:07"]]);
			const args = JSON.parse(readFileSync(join(dir, "args.json"), "utf8")) as string[];
			assert.ok(args.includes("--progress"));
		}, `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
const output = Buffer.from('[download] 12.5% of ~3.0MiB at 1.0MiB/s ETA 00:07\\n' + JSON.stringify('ffmpeg/Mäuse.mp3'));
let i = 0; const timer = setInterval(() => { process.stdout.write(output.subarray(i, ++i)); if(i === output.length) clearInterval(timer); }, 1);`);
	} finally { Math.random = oldRandom; }
});

test("rejects successful subprocesses that never report a final file", async () => {
	await withDownloader(async () => {
		await assert.rejects(new YouTubeDL().download("https://youtu.be/J2JPiQ2aEBc", () => {}), (error: unknown) => {
			assert.match(String(error), /final.*file/i);
			return true;
		});
	}, `console.log('[download] Destination: ffmpeg/source.webm');`);
});

test("fails early with installation guidance when yt-dlp is missing", async () => {
	await withDownloader(async (dir) => {
		rmSync(join(dir, "yt-dlp"));
		await assert.rejects(new YouTubeDL().download("https://youtu.be/J2JPiQ2aEBc", () => {}), (error: unknown) => {
			assert.match(String(error), /yt-dlp.*rebuild/i);
			return true;
		});
	}, "");
});

test("explains YouTube bot verification without returning raw authentication diagnostics", async () => {
	await withDownloader(async () => {
		await assert.rejects(new YouTubeDL().download("https://youtu.be/J2JPiQ2aEBc", () => {}), (error) => {
			assert.equal(typeof error, "string");
			assert.match(String(error), /YTDLP_COOKIES_FILE/);
			assert.doesNotMatch(String(error), /sensitive-diagnostic/);
			return true;
		});
	}, `console.error("ERROR: Sign in to confirm you’re not a bot. sensitive-diagnostic"); process.exit(1);`);
});

test("passes only an explicitly configured operator cookie file as one argument", async () => {
	await withDownloader(async (dir) => {
		const cookieFile = join(dir, "operator cookies.txt");
		writeFileSync(cookieFile, "# Netscape HTTP Cookie File\n");
		process.env.YTDLP_COOKIES_FILE = cookieFile;
		await new YouTubeDL().download("https://youtu.be/J2JPiQ2aEBc", () => {});
		const args = JSON.parse(readFileSync(join(dir, "args.json"), "utf8")) as string[];
		assert.equal(args[args.indexOf("--cookies") + 1], cookieFile);
		assert.ok(!args.includes("--cookies-from-browser"));
	}, `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify('ffmpeg/A title.mp3'));`);
});

test("downloads with yt-dlp and returns the final MP3 path instead of the source destination", async () => {
	await withDownloader(async (dir) => {
		const url = "https://youtu.be/J2JPiQ2aEBc?si=BjCc9_q9_MEdy_8H";
		const file = await new YouTubeDL().download(url, () => {});
		assert.equal(file, "ffmpeg/A title.mp3");
		const args = JSON.parse(readFileSync(join(dir, "args.json"), "utf8")) as string[];
		assert.ok(args.includes("--ignore-config"));
		assert.equal(args[args.indexOf("--js-runtimes") + 1], "node");
		assert.equal(args[args.indexOf("--audio-format") + 1], "mp3");
		assert.equal(args[args.indexOf("--print") + 1], "after_move:%(filepath)j");
		assert.deepEqual(args.slice(-2), ["--", url]);
		assert.ok(!args.includes("--cookies"));
	}, `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args.json'), JSON.stringify(process.argv.slice(2)));
console.log('[download] Destination: ffmpeg/A title.webm');
console.log(JSON.stringify('ffmpeg/A title.mp3'));`);
});
