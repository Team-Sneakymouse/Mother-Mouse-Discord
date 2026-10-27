import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

// A reservation is durable BEFORE the external send. Never blindly retry uncertainty.
export async function deliver(io: {
	lookup(): Promise<string | undefined>;
	reserve(): Promise<boolean>;
	send(): Promise<string>;
	ack(id: string): Promise<void>;
}) {
	let id = await io.lookup();
	if (!id) {
		if (!(await io.reserve())) throw Error("Uncertain Discord delivery: manual reconciliation required");
		id = await io.send();
	}
	await io.ack(id);
}
export async function deliveryStore(dir: string) {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const path = (id: string, suffix: string) => {
		if (!/^[a-z0-9]{15}$/.test(id)) throw Error("Invalid job ID");
		return join(dir, `${id}.${suffix}`);
	};
	async function create(file: string, data: string): Promise<boolean> {
		let handle;
		try {
			handle = await open(file, "wx", 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw error;
		}
		try {
			await handle.writeFile(data);
			await handle.sync();
		} finally {
			await handle.close();
		}
		const directory = await open(dir, "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
		return true;
	}
	return {
		reserve: (id: string) => create(path(id, "reserved"), "reserved\n"),
		lookup: async (id: string) => {
			try {
				const value = (await readFile(path(id, "sent"), "utf8")).trim();
				if (!/^[0-9]{1,30}$/.test(value)) throw Error("Corrupt job delivery journal");
				return value;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw error;
			}
		},
		save: async (id: string, message: string) => {
			if (!/^[0-9]{1,30}$/.test(message)) throw Error("Invalid message ID");
			await create(path(id, "sent"), message + "\n");
		},
	};
}
export type DeliveryStore = Awaited<ReturnType<typeof deliveryStore>>;
export function startPolling(tick: () => Promise<void>, onError: (error: unknown) => void, interval = 5000): () => Promise<void> {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void>;
	const run = () => {
		running = (async () => {
			try {
				await tick();
			} catch (error) {
				onError(error);
			} finally {
				if (!stopped) {
					timer = setTimeout(run, interval);
					timer.unref();
				}
			}
		})();
	};
	run();
	return async () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		await running;
	};
}
