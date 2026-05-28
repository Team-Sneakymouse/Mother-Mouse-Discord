import { z } from "zod";

function isValidDateString(value: string): boolean {
	return !Number.isNaN(new Date(value).valueOf());
}

function isUrlString(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, "must be a non-empty string");
const urlString = z.string().refine(isUrlString, "must be a URL string");

export const twitchShamePayloadSchema = z.object({
	id: nonEmptyString,
	channel: nonEmptyString,
	channelId: z.string().nullable(),
	sentAt: nonEmptyString.refine(isValidDateString, "must be a valid date string"),
	user: z.object({
		id: nonEmptyString,
		login: nonEmptyString,
		displayName: nonEmptyString,
		color: z.string().nullable(),
		badges: z
			.array(
				z.object({
					setId: nonEmptyString,
					version: nonEmptyString,
					imageUrl: urlString.optional(),
				}),
			)
			.max(12, "must contain at most 12 badges"),
	}),
	fragments: z
		.discriminatedUnion("type", [
			z.object({
				type: z.literal("text"),
				text: z.string(),
			}),
			z.object({
				type: z.literal("emote"),
				text: nonEmptyString,
				id: nonEmptyString,
				imageUrl: urlString,
			}),
		])
		.array()
		.min(1, "must be a non-empty array")
		.max(100, "must contain at most 100 items"),
});

export type TwitchShamePayload = z.infer<typeof twitchShamePayloadSchema>;
export type TwitchShameBadge = TwitchShamePayload["user"]["badges"][number];
export type TwitchShameFragment = TwitchShamePayload["fragments"][number];
export type TwitchShameTextFragment = Extract<TwitchShameFragment, { type: "text" }>;
export type TwitchShameEmoteFragment = Extract<TwitchShameFragment, { type: "emote" }>;

export function formatZodError(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "Invalid payload";
	const path = issue.path.length > 0 ? issue.path.join(".") : "body";
	return `${path}: ${issue.message}`;
}
