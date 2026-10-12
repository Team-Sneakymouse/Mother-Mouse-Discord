import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import YouTube from "../src/YouTube.ts";

const samples: [number, string, string][] = [
	[0, "n/a", "`[=                     ]` 0.0%, ETA n/a"],
	[50, "00:07", "`[============          ]` 50.0%, ETA 00:07"],
	[12.34, "01:23", "`[===                   ]` 12.3%, ETA 01:23"],
	[100, "00:00", "`[======================]` 100.0%, ETA 00:00"],
];

test("file-local formatProgress preserves the existing bar, percentage and ETA", () => {
	const source = readFileSync(new URL("../src/YouTube.ts", import.meta.url), "utf8");
	const ast = ts.createSourceFile("YouTube.ts", source, ts.ScriptTarget.Latest, true);
	const helper = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "formatProgress");
	assert.ok(helper, "missing file-local formatProgress helper");
	assert.ok(!helper.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
	const js = ts.transpile(helper.getText(ast), { target: ts.ScriptTarget.ES2022 });
	const formatProgress = runInNewContext(`${js}; formatProgress`) as (progress: number, eta: string) => string;
	for (const [progress, eta, expected] of samples) assert.equal(formatProgress(progress, eta), expected);
});

function handlers(ytdl: unknown) {
	const callbacks = new Map<string, (event: any) => Promise<void>>();
	const client = { user: { id: "bot" }, on: (name: string, callback: (event: any) => Promise<void>) => callbacks.set(name, callback) };
	YouTube(client as never, ytdl as never);
	return callbacks;
}

test("modal download and resample progress still edit immediately with unchanged labels", async () => {
	const edits: unknown[] = [];
	const callbacks = handlers({
		download: async (_url: string, progress: (p: number, eta: string) => void) => {
			for (const [p, eta] of samples) progress(p, eta);
			assert.equal(edits.length, samples.length);
			return "video.mp3";
		},
		resample: async (_file: string, _speed: string, _pitch: string, progress: (p: number, eta: string) => void) => {
			for (const [p, eta] of samples) progress(p, eta);
			assert.equal(edits.length, samples.length * 2);
			return "video.mp3";
		},
	});
	const modal = {
		fields: { getTextInputValue: (name: string) => (name === "youtube-dl-url" ? "https://example.com/video" : "1") },
		reply: async () => {},
		editReply: async (content: unknown) => {
			edits.push(content);
		},
	};
	await callbacks.get("interactionCreate")!({
		isChatInputCommand: () => true,
		commandName: "youtube-dl",
		options: { get: () => undefined },
		showModal: async () => {},
		awaitModalSubmit: async () => modal,
	});
	assert.deepEqual(
		edits.slice(0, samples.length * 2),
		["Downloading", "Resampling"].flatMap((label) => samples.map(([, , text]) => `${label} <a:typing:990723371522195526>\n${text}`)),
	);
});

test("message progress retains the two-second throttle and latest per-URL state", async () => {
	const oldNow = Date.now;
	let now = 10000;
	Date.now = () => now;
	const edits: unknown[] = [];
	try {
		const callbacks = handlers({
			download: async (url: string, progress: (p: number, eta: string) => void) => {
				if (url.endsWith("/first")) {
					progress(0, "n/a");
					now += 1999;
					progress(12.34, "01:23");
					assert.equal(edits.length, 0);
					now += 1;
					progress(50, "00:07");
					assert.equal(edits.length, 1);
				} else {
					progress(0, "n/a");
					assert.equal(edits.length, 1);
					now += 2000;
					progress(100, "00:00");
					assert.equal(edits.length, 2);
				}
				return "video.mp3";
			},
		});
		await callbacks.get("messageCreate")!({
			channelId: "990732990365720647",
			author: { id: "user" },
			content: "https://example.com/first https://example.com/second",
			reply: async () => ({
				edit: async (content: unknown) => {
					edits.push(content);
				},
			}),
		});
		assert.deepEqual(edits.slice(0, 2), [
			`Downloading <a:typing:990723371522195526>\n${samples[1][2]}\nwaiting for start... 0%, ETA n/a`,
			`Downloading <a:typing:990723371522195526>\n${samples[1][2]}\n${samples[3][2]}`,
		]);
	} finally {
		Date.now = oldNow;
	}
});
