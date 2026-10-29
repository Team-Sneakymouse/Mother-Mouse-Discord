import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express } from "express";
import type { PushStore } from "./store.js";
import type { PushTracker } from "./tracker.js";

function equal(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function validSignature(secret: string, body: Buffer, header: string | undefined): boolean {
	return equal(header ?? "", `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
}

type Ready = () => Promise<{ tracker: PushTracker; store: PushStore } | undefined>;

/**
 * Registers `POST /github` and `POST /watchtower`. Call before any global body parser:
 * the GitHub signature covers the raw request body.
 */
export function registerPushTrackingRoutes(
	server: Express,
	ready: Ready,
	secrets: { github: () => string | undefined; watchtower: () => string | undefined } = {
		github: () => process.env.GITHUB_WEBHOOK_SECRET,
		watchtower: () => process.env.WATCHTOWER_WEBHOOK_TOKEN,
	},
): void {
	server.post("/github", express.raw({ type: () => true, limit: "5mb" }), async (req, res) => {
		const secret = secrets.github();
		if (!secret) return void res.sendStatus(503);
		const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
		if (!validSignature(secret, body, req.get("X-Hub-Signature-256"))) return void res.sendStatus(401);
		const event = req.get("X-GitHub-Event");
		const delivery = req.get("X-GitHub-Delivery");
		if (event === "ping") return void res.sendStatus(200);
		if (event !== "push" && event !== "workflow_run") return void res.sendStatus(204);
		if (!delivery || delivery.length > 100) return void res.sendStatus(400);
		let payload: unknown;
		try {
			payload = JSON.parse(body.toString("utf8"));
		} catch {
			return void res.sendStatus(400);
		}
		const feature = await ready();
		if (!feature) return void res.sendStatus(503);
		try {
			if (!(await feature.store.claimDelivery(delivery, "github"))) return void res.sendStatus(200);
		} catch {
			console.error("PushTracking: could not record GitHub delivery");
			return void res.sendStatus(503);
		}
		try {
			if (event === "push") await feature.tracker.push(payload);
			else await feature.tracker.workflowRun(payload);
			res.sendStatus(202);
		} catch (error) {
			// Let a manual redelivery from GitHub retry this event.
			await feature.store.releaseDelivery(delivery).catch(() => {});
			const invalid = (error as Error)?.name === "ZodError";
			if (!invalid) console.error(`PushTracking: GitHub ${event} delivery ${delivery} failed: ${(error as Error)?.message ?? error}`);
			res.sendStatus(invalid ? 400 : 503);
		}
	});

	// Watchtower's generic notifier sends its JSON report as text/plain.
	server.post("/watchtower", express.text({ type: () => true, limit: "1mb" }), async (req, res) => {
		const token = secrets.watchtower();
		if (!token) return void res.sendStatus(503);
		if (!equal(req.get("Authorization") ?? "", `Bearer ${token}`)) return void res.sendStatus(401);
		let payload: unknown;
		try {
			payload = JSON.parse(typeof req.body === "string" ? req.body : "");
		} catch {
			return void res.sendStatus(400);
		}
		const feature = await ready();
		if (!feature) return void res.sendStatus(503);
		try {
			await feature.tracker.watchtower(payload);
			res.sendStatus(202);
		} catch (error) {
			const invalid = (error as Error)?.name === "ZodError";
			if (!invalid) console.error(`PushTracking: Watchtower notification failed: ${(error as Error)?.message ?? error}`);
			res.sendStatus(invalid ? 400 : 503);
		}
	});
}
