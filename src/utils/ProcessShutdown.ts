import type { EventEmitter } from "node:events";

/** The process, not an individual feature, owns stop signals and final exit. */
export function installProcessShutdown(io: {
	signals: Pick<EventEmitter, "on" | "off">;
	stopWork: () => Promise<void>;
	close: Array<() => Promise<void>>;
	exit: (code: number) => void;
	onError: (error: unknown) => void;
	timeout?: number;
}) {
	let running: Promise<void> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let exited = false;
	const exit = (code: number) => {
		if (exited) return;
		exited = true;
		if (timer) clearTimeout(timer);
		io.exit(code);
	};
	const shutdown = () => {
		if (running) return running;
		timer = setTimeout(() => {
			io.onError(Error("Bot shutdown deadline exceeded"));
			exit(1);
		}, io.timeout ?? 30000);
		running = (async () => {
			let failed = false;
			try {
				await io.stopWork();
			} catch (error) {
				failed = true;
				io.onError(error);
			}
			const results = await Promise.allSettled(
				io.close.map(async (close) => {
					await close();
				}),
			);
			for (const result of results)
				if (result.status === "rejected") {
					failed = true;
					io.onError(result.reason);
				}
			exit(failed ? 1 : 0);
		})();
		return running;
	};
	const onSignal = () => {
		void shutdown();
	};
	io.signals.on("SIGTERM", onSignal);
	io.signals.on("SIGINT", onSignal);
	return {
		shutdown,
		dispose: () => {
			io.signals.off("SIGTERM", onSignal);
			io.signals.off("SIGINT", onSignal);
			if (timer) clearTimeout(timer);
		},
	};
}
