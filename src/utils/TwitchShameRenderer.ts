import { readFile } from "node:fs/promises";
import path from "node:path";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import type { TwitchShameBadge, TwitchShameEmoteFragment, TwitchShamePayload, TwitchShameTextFragment } from "./validation/TwitchShamePayload.js";

type SatoriNode = {
	type: string;
	props: Record<string, unknown>;
};

type RenderBadge = TwitchShameBadge & {
	dataUrl?: string;
};

type RenderTextFragment = TwitchShameTextFragment;

type RenderEmoteFragment = TwitchShameEmoteFragment & {
	dataUrl?: string;
};

type RenderPayload = Omit<TwitchShamePayload, "user" | "fragments"> & {
	user: Omit<TwitchShamePayload["user"], "badges"> & {
		badges: RenderBadge[];
	};
	fragments: Array<RenderTextFragment | RenderEmoteFragment>;
};

const width = 760;
const horizontalPadding = 24;
const contentWidth = width - horizontalPadding * 2;
const maxAssetBytes = 512 * 1024;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function el(
	type: string,
	style: Record<string, unknown>,
	children?: string | SatoriNode | Array<string | SatoriNode>,
	props: Record<string, unknown> = {},
): SatoriNode {
	return { type, props: { ...props, style, children } };
}

function img(style: Record<string, unknown>, src: string, alt: string): SatoriNode {
	return { type: "img", props: { src, alt, style } };
}

async function loadFonts() {
	return [
		{
			name: "Inter",
			data: await readFile(path.resolve("static", "Inter_18pt-Regular.ttf")),
			weight: 400 as const,
			style: "normal" as const,
		},
		{
			name: "Inter",
			data: await readFile(path.resolve("static", "Inter_18pt-Bold.ttf")),
			weight: 700 as const,
			style: "normal" as const,
		},
	];
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function contentTypeToDataUrlPrefix(contentType: string | null): string {
	const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
	if (normalized?.startsWith("image/")) return `data:${normalized};base64,`;
	return "data:image/png;base64,";
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
	if (!isHttpsUrl(url)) throw new Error(`Refusing non-HTTPS asset URL: ${url}`);

	const response = await fetch(url);
	if (!response.ok) throw new Error(`Asset fetch failed with ${response.status} for ${url}`);

	const contentLength = Number(response.headers.get("content-length") ?? "0");
	if (contentLength > maxAssetBytes) throw new Error(`Asset exceeds ${maxAssetBytes} bytes: ${url}`);

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength > maxAssetBytes) throw new Error(`Asset exceeds ${maxAssetBytes} bytes: ${url}`);

	return `${contentTypeToDataUrlPrefix(response.headers.get("content-type"))}${bytes.toString("base64")}`;
}

async function withLoadedAssets(payload: TwitchShamePayload): Promise<RenderPayload> {
	const badges = await Promise.all(
		payload.user.badges.slice(0, 12).map(async (badge) => {
			if (!badge.imageUrl) return badge;
			try {
				return { ...badge, dataUrl: await fetchImageAsDataUrl(badge.imageUrl) };
			} catch (error) {
				console.error(`TwitchShame asset-loading badge failed (${badge.setId}/${badge.version}): ${errorMessage(error)}`);
				return badge;
			}
		}),
	);

	const fragments = await Promise.all(
		payload.fragments.slice(0, 100).map(async (fragment) => {
			if (fragment.type === "text") return fragment;
			try {
				return { ...fragment, dataUrl: await fetchImageAsDataUrl(fragment.imageUrl) };
			} catch (error) {
				console.error(`TwitchShame asset-loading emote failed (${fragment.text}/${fragment.id}): ${errorMessage(error)}`);
				return fragment;
			}
		}),
	);

	return {
		...payload,
		user: {
			...payload.user,
			badges,
		},
		fragments,
	};
}

function sanitizeNameColor(color: string | null): string {
	if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
	return "#A970FF";
}

function formatTimestamp(sentAt: string): string {
	const date = new Date(sentAt);
	if (Number.isNaN(date.valueOf())) return "";
	const parts = new Intl.DateTimeFormat("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "America/Toronto",
		timeZoneName: "short",
		hour12: false,
	}).formatToParts(date);
	const hour = parts.find((part) => part.type === "hour")?.value;
	const minute = parts.find((part) => part.type === "minute")?.value;
	const timezone = parts.find((part) => part.type === "timeZoneName")?.value;
	if (!hour || !minute) return "";
	return `${hour}:${minute}${timezone ? ` ${timezone}` : ""}`;
}

function textWidthEstimate(text: string, fontSize: number): number {
	let width = 0;
	for (const char of text) {
		if (char === " ") width += fontSize * 0.32;
		else if (/[il.,'!:;]/.test(char)) width += fontSize * 0.28;
		else if (/[A-ZMW@#]/.test(char)) width += fontSize * 0.68;
		else width += fontSize * 0.52;
	}
	return width;
}

function estimateHeight(payload: TwitchShamePayload): number {
	let lineWidth = textWidthEstimate(`${payload.user.displayName}: `, 19) + payload.user.badges.length * 22;
	let lines = 1;

	for (const fragment of payload.fragments) {
		if (fragment.type === "emote") {
			const tokenWidth = 34;
			if (lineWidth + tokenWidth > contentWidth) {
				lines += 1;
				lineWidth = tokenWidth;
			} else {
				lineWidth += tokenWidth;
			}
			continue;
		}

		const parts = fragment.text.split(/(\s+)/);
		for (const part of parts) {
			const tokenWidth = textWidthEstimate(part, 19);
			if (lineWidth > 0 && lineWidth + tokenWidth > contentWidth) {
				lines += 1;
				lineWidth = Math.min(tokenWidth, contentWidth);
			} else {
				lineWidth += tokenWidth;
			}
		}
	}

	return 60 + lines * 33;
}

function textTokens(text: string): string[] {
	return text.split(/(\s+)/).filter((token) => token.length > 0);
}

function collapseRepeatedSpaces(payload: TwitchShamePayload): TwitchShamePayload {
	return {
		...payload,
		fragments: payload.fragments.map((fragment) => {
			if (fragment.type === "emote") return fragment;
			return {
				...fragment,
				text: fragment.text.replace(/\s{2,}/g, " "),
			};
		}),
	};
}

function buildMessage(payload: RenderPayload, height: number): SatoriNode {
	const timestamp = formatTimestamp(payload.sentAt);
	const displayColor = sanitizeNameColor(payload.user.color);
	const messageChildren: Array<string | SatoriNode> = [
		...payload.user.badges
			.filter((badge) => badge.dataUrl)
			.map((badge) =>
				img(
					{
						width: 18,
						height: 18,
						marginRight: 4,
						objectFit: "contain",
					},
					badge.dataUrl!,
					badge.setId,
				),
			),
		el(
			"span",
			{
				color: displayColor,
				fontSize: 19,
				fontWeight: 700,
				lineHeight: 1.45,
			},
			payload.user.displayName,
		),
		el(
			"span",
			{
				color: "#EFEFF1",
				fontSize: 19,
				fontWeight: 400,
				lineHeight: 1.45,
				marginRight: 5,
			},
			":",
		),
	];

	for (const fragment of payload.fragments) {
		if (fragment.type === "emote") {
			if (fragment.dataUrl) {
				messageChildren.push(
					img(
						{
							width: 30,
							height: 30,
							marginLeft: 0,
							marginRight: 0,
							objectFit: "contain",
						},
						fragment.dataUrl,
						fragment.text,
					),
				);
			} else {
				messageChildren.push(
					el(
						"span",
						{
							color: "#EFEFF1",
							fontSize: 19,
							fontWeight: 400,
							lineHeight: 1.45,
							marginRight: 4,
						},
						fragment.text,
					),
				);
			}
			continue;
		}

		for (const token of textTokens(fragment.text)) {
			messageChildren.push(
				el(
					"span",
					{
						color: "#EFEFF1",
						fontSize: 19,
						fontWeight: 400,
						lineHeight: 1.45,
						whiteSpace: "pre",
					},
					token,
				),
			);
		}
	}

	return el(
		"div",
		{
			width,
			height,
			display: "flex",
			flexDirection: "column",
			backgroundColor: "#18181B",
			border: "1px solid #2F2F35",
			boxSizing: "border-box",
			fontFamily: "Inter",
			padding: `18px ${horizontalPadding}px`,
		},
		[
			el(
				"div",
				{
					width: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 10,
				},
				[
					el(
						"div",
						{
							display: "flex",
							alignItems: "center",
							color: "#ADADB8",
							fontSize: 14,
							fontWeight: 700,
							textTransform: "uppercase",
							letterSpacing: 0,
						},
						"TWITCH CHAT",
					),
					el(
						"div",
						{
							display: "flex",
							alignItems: "center",
							color: "#ADADB8",
							fontSize: 14,
							fontWeight: 400,
						},
						`${payload.channel}${timestamp ? ` - ${timestamp}` : ""}`,
					),
				],
			),
			el(
				"div",
				{
					width: "100%",
					display: "flex",
					flexDirection: "row",
					flexWrap: "wrap",
					alignItems: "center",
				},
				messageChildren,
			),
		],
	);
}

export async function renderTwitchShamePng(payload: TwitchShamePayload): Promise<Buffer> {
	const normalizedPayload = collapseRepeatedSpaces(payload);
	const [fonts, renderPayload] = await Promise.all([loadFonts(), withLoadedAssets(normalizedPayload)]);
	const height = estimateHeight(normalizedPayload);
	const svg = await satori(buildMessage(renderPayload, height), {
		width,
		height,
		fonts,
	});

	return new Resvg(svg, {
		fitTo: {
			mode: "width",
			value: width,
		},
		background: "#18181B",
	})
		.render()
		.asPng();
}
