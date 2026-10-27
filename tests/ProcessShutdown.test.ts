import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { installProcessShutdown } from "../src/utils/ProcessShutdown.ts";

test("process shutdown awaits feature stop, closes connections, exits once", async () => {
	const signals = new EventEmitter();
	const effects: string[] = [];
	let release!: () => void;
	const lifecycle = installProcessShutdown({
		signals,
		stopWork: async () => {
			effects.push("stop");
			await new Promise<void>((r) => {
				release = r;
			});
		},
		close: [
			async () => {
				effects.push("http");
			},
			async () => {
				effects.push("discord");
			},
			async () => {
				effects.push("pb");
			},
		],
		exit: (code) => {
			effects.push(`exit:${code}`);
		},
		onError: () => {},
		timeout: 1000,
	});
	signals.emit("SIGTERM");
	signals.emit("SIGINT");
	assert.deepEqual(effects, ["stop"]);
	release();
	await lifecycle.shutdown();
	assert.deepEqual(effects, ["stop", "http", "discord", "pb", "exit:0"]);
	lifecycle.dispose();
	assert.equal(signals.listenerCount("SIGTERM"), 0);
});
test("failed feature stop still closes all connections and exits with failure", async () => {
	const effects: string[] = [];
	const lifecycle = installProcessShutdown({
		signals: new EventEmitter(),
		stopWork: async () => {
			throw Error("failed");
		},
		close: [
			async () => {
				effects.push("close");
			},
		],
		exit: (code) => {
			effects.push(`exit:${code}`);
		},
		onError: () => {},
		timeout: 1000,
	});
	await lifecycle.shutdown();
	assert.deepEqual(effects, ["close", "exit:1"]);
	lifecycle.dispose();
});
test("stuck cleanup cannot suppress process termination indefinitely", async () => {
	let exit!: number;
	let done!: () => void;
	const observed = new Promise<void>((r) => {
		done = r;
	});
	const lifecycle = installProcessShutdown({
		signals: new EventEmitter(),
		stopWork: () => new Promise(() => {}),
		close: [],
		exit: (code) => {
			exit = code;
			done();
		},
		onError: () => {},
		timeout: 5,
	});
	void lifecycle.shutdown();
	await observed;
	assert.equal(exit, 1);
	lifecycle.dispose();
});
