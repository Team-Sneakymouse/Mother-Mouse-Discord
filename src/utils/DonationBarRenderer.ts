import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";
import type { RecordModel } from "pocketbase";
import satori from "satori";

export type DonationBarRecord = RecordModel & {
	amount: number;
	goal: number;
	text: string;
	enabled: boolean;
	channel: string;
	lastDonation: string;
	types: string[];
};

type SatoriNode = {
	type: string;
	props: Record<string, unknown>;
};

type DonationBarRenderConfig = {
	width: number;
	height: number;
	frameCount: number;
	frameRate: number;
};

const renderConfig: DonationBarRenderConfig = {
	width: 1200,
	height: 170,
	frameCount: 28,
	frameRate: 10,
};

function el(
	type: string,
	style: Record<string, unknown>,
	children?: string | SatoriNode | Array<string | SatoriNode>,
	props: Record<string, unknown> = {},
): SatoriNode {
	return { type, props: { ...props, style, children } };
}

async function loadEmojiImages(): Promise<Record<string, string>> {
	const clownFace = await readFile(path.resolve("static", "emoji", "1f921.svg"));
	const circusTent = await readFile(path.resolve("static", "emoji", "1f3aa.svg"));

	return {
		"\u{1F921}": `data:image/svg+xml;base64,${clownFace.toString("base64")}`,
		"\u{1F3AA}": `data:image/svg+xml;base64,${circusTent.toString("base64")}`,
	};
}

async function loadFonts() {
	return [
		{
			name: "Lobster Two",
			data: await readFile(path.resolve("static", "LobsterTwo-Regular.ttf")),
			weight: 400 as const,
			style: "normal" as const,
		},
		{
			name: "Lobster Two",
			data: await readFile(path.resolve("static", "LobsterTwo-Bold.ttf")),
			weight: 700 as const,
			style: "normal" as const,
		},
	];
}

function formatCurrencyFromCents(value: number): string {
	return `$${(value / 100).toFixed(2)}`;
}

function pulseAt(frame: number, frameCount: number): number {
	const progress = frame / frameCount;
	return (Math.sin(progress * Math.PI * 4) + 1) / 2;
}

function shimmerAt(frame: number, frameCount: number): number {
	const progress = frameCount <= 1 ? 0 : frame / (frameCount - 1);
	return -100 + progress * 300;
}

function buildDonationBar(record: DonationBarRecord, frame: number, fontFamily: string, config: DonationBarRenderConfig): SatoriNode {
	const progress = record.goal <= 0 ? 0 : Math.max(0, Math.min(100, (record.amount / record.goal) * 100));
	const fillWidth = progress > 0 ? Math.max(progress, 8) : 0;
	const pulse = pulseAt(frame, config.frameCount);
	const shimmer = shimmerAt(frame, config.frameCount);
	const glowOpacity = 0.2 + pulse * 0.55;
	const titleGlow = 0.2 + pulse * 0.35;
	const gradientShift = (pulse - 0.5) * 8;
	const stop1 = Math.max(0, 0 + gradientShift);
	const stop2 = Math.min(100, 30 + gradientShift);
	const stop3 = Math.min(100, 60 + gradientShift);
	const stop4 = Math.min(100, 85 + gradientShift);
	const shimmerOpacity = 0.22 + pulse * 0.23;
	const shimmerWidth = 48;

	return el(
		"div",
		{
			width: `${config.width}px`,
			height: `${config.height}px`,
			display: "flex",
			backgroundColor: "transparent",
			padding: "12px 18px 16px",
			boxSizing: "border-box",
			fontFamily,
		},
		el(
			"div",
			{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "flex-start",
			},
			[
				el(
					"div",
					{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						color: "#ffffff",
						fontSize: 36,
						fontWeight: 700,
						letterSpacing: 0.4,
						marginBottom: 12,
						textShadow: `2px 2px 0 #000000, -1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000, 0 0 12px rgba(255, 110, 181, ${titleGlow})`,
					},
					record.text,
				),
				el(
					"div",
					{
						width: "100%",
						height: 54,
						display: "flex",
						alignItems: "stretch",
						borderRadius: 999,
						border: "3px solid rgba(255, 255, 255, 0.25)",
						backgroundColor: "rgba(0, 0, 0, 0.45)",
						boxShadow: `0 0 18px rgba(255, 80, 180, ${glowOpacity})`,
						overflow: "hidden",
					},
					fillWidth === 0
						? undefined
						: el(
								"div",
								{
									width: `${fillWidth}%`,
									height: "100%",
									display: "flex",
									position: "relative",
									borderRadius: 999,
									backgroundImage: `linear-gradient(90deg, #ff6eb5 ${stop1}%, #ff3fa0 ${stop2}%, #ff69c8 ${stop3}%, #ff9de0 ${stop4}%, #ffb3e8 100%)`,
									boxShadow: `0 0 20px rgba(255, 80, 180, ${0.3 + pulse * 0.5})`,
									overflow: "hidden",
								},
								el("div", {
									position: "absolute",
									top: 0,
									bottom: 0,
									left: `${shimmer}%`,
									width: `${shimmerWidth}%`,
									backgroundImage: `linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, ${shimmerOpacity}) 50%, transparent 100%)`,
									opacity: 0.95,
									transform: "skewX(-20deg)",
								}),
							),
				),
				el(
					"div",
					{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						height: 0,
						marginTop: -26,
						marginBottom: 23,
						color: "#ffffff",
						fontSize: 24,
						fontWeight: 400,
						textShadow: "2px 2px 0 #000000, -1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000, 0 0 8px rgba(0, 0, 0, 0.9)",
					},
					`${Math.round(progress)}%`,
				),
				el(
					"div",
					{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "10px 6px 0",
						color: "#ffffff",
					},
					[
						el(
							"div",
							{
								fontSize: 28,
								fontWeight: 400,
								textShadow: "1px 1px 0 #000000, 0 2px 6px rgba(0, 0, 0, 0.7)",
							},
							formatCurrencyFromCents(record.amount),
						),
						el(
							"div",
							{
								fontSize: 28,
								fontWeight: 400,
								color: "rgba(255, 255, 255, 0.78)",
								textShadow: "1px 1px 0 #000000, 0 2px 6px rgba(0, 0, 0, 0.7)",
							},
							`Goal: ${formatCurrencyFromCents(record.goal)}`,
						),
					],
				),
			],
		),
	);
}

async function runFfmpeg(args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("ffmpeg", args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`ffmpeg exited with code ${code}`));
		});
	});
}

export async function renderDonationBarWebp(record: DonationBarRecord): Promise<Buffer> {
	const [fonts, graphemeImages] = await Promise.all([loadFonts(), loadEmojiImages()]);
	const framesDir = await mkdtemp(path.join(tmpdir(), "dono-webp-"));
	const outputPath = path.join(framesDir, "donation-bar.webp");

	try {
		for (let frame = 0; frame < renderConfig.frameCount; frame += 1) {
			const svg = await satori(buildDonationBar(record, frame, "Lobster Two", renderConfig), {
				width: renderConfig.width,
				height: renderConfig.height,
				fonts,
				graphemeImages,
			});

			const png = new Resvg(svg, {
				fitTo: {
					mode: "width",
					value: renderConfig.width,
				},
				background: "rgba(0, 0, 0, 0)",
			})
				.render()
				.asPng();

			await writeFile(path.join(framesDir, `frame-${frame.toString().padStart(3, "0")}.png`), png);
		}

		await mkdir(path.dirname(outputPath), { recursive: true });
		await runFfmpeg([
			"-loglevel",
			"error",
			"-y",
			"-framerate",
			String(renderConfig.frameRate),
			"-i",
			path.join(framesDir, "frame-%03d.png"),
			"-loop",
			"0",
			"-c:v",
			"libwebp_anim",
			"-quality",
			"88",
			"-lossless",
			"0",
			"-pix_fmt",
			"yuva420p",
			outputPath,
		]);

		return await readFile(outputPath);
	} finally {
		await rm(framesDir, { recursive: true, force: true });
	}
}
