import { z } from "zod";
import { isAbsolute } from "node:path";
const jobSchema = z.object({
	id: z.string().regex(/^[a-z0-9]{15}$/),
	serverPort: z.literal(50001),
	category: z.string(),
	posterDisplayString: z.string(),
	posterIconBase64: z.string(),
	location: z.string(),
	locationDisplayString: z.string(),
	startTime: z.number().finite().nonnegative(),
	name: z.string(),
	description: z.string(),
	discordEmbedIcon: z.string(),
	discordMessageId: z.string().nullish(),
	endTime: z.number().finite().nonnegative(),
	endReason: z.string().nullish(),
});
export type JobData = z.infer<typeof jobSchema>;
const claimSchema = z.object({
	items: z.array(z.object({ eventId: z.string().min(1), leaseToken: z.string().min(1), kind: z.enum(["create", "end"]), job: jobSchema })).max(1),
	hasMore: z.boolean(),
});
export const parseClaim = (data: unknown) => claimSchema.parse(data);
export type Claim = z.infer<typeof claimSchema>["items"][number];
export function hooksConfig(env: NodeJS.ProcessEnv = process.env) {
	const url = new URL(env.JOBBOARD_HOOKS_URL ?? "");
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
		throw Error("JOBBOARD_HOOKS_URL must be credential-free HTTPS");
	const secret = env.JOBBOARD_INTERNAL_SECRET?.trim();
	const stateDir = env.JOBBOARD_STATE_DIR;
	if (!secret || !stateDir || !isAbsolute(stateDir)) throw Error("Jobboard requires internal secret and absolute durable JOBBOARD_STATE_DIR");
	return { url: url.origin, secret, stateDir };
}
export function hooksApi(config: ReturnType<typeof hooksConfig>, signal: AbortSignal) {
	async function request(path: string, body: unknown) {
		const response = await fetch(`${config.url}/internal/lom/jobs/discord/${path}`, {
			method: "POST",
			redirect: "error",
			headers: { "Content-Type": "application/json", "X-Internal-Secret": config.secret },
			body: JSON.stringify(body),
			signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
		});
		if (!response.ok) throw Error(`Job hooks ${path}: HTTP ${response.status}`);
		return response.json();
	}
	return {
		claim: async () => parseClaim(await request("claim", { limit: 1 })),
		ack: async (item: Claim, discordMessageId?: string) => {
			const data = await request("ack", { eventId: item.eventId, leaseToken: item.leaseToken, ...(discordMessageId ? { discordMessageId } : {}) });
			z.object({ ok: z.literal(true) }).parse(data);
		},
	};
}
