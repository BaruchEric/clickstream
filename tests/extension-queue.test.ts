import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("extension retains offline visits and delivers once after reconnect", async () => {
	const state: Record<string, unknown> = {
		recording: true,
		token: "test-token",
	};
	const listeners: Record<string, (...args: unknown[]) => unknown> = {};
	const listener = (key: string) => ({
		addListener: (fn: (...args: unknown[]) => unknown) => {
			listeners[key] = fn;
		},
	});
	let online = false;
	const delivered: unknown[] = [];
	const chrome = {
		storage: {
			local: {
				get: async () => structuredClone(state),
				set: async (values: Record<string, unknown>) =>
					Object.assign(state, structuredClone(values)),
			},
		},
		runtime: {
			id: "test",
			onInstalled: listener("installed"),
			onStartup: listener("startup"),
			onMessage: listener("message"),
		},
		alarms: { create: () => {}, onAlarm: listener("alarm") },
		history: { onVisited: listener("visit") },
	};
	runInNewContext(
		readFileSync(
			new URL("../extension/background.js", import.meta.url),
			"utf8",
		),
		{
			chrome,
			AbortSignal,
			fetch: async (_url: string, opts: { body: string }) => {
				if (!online) throw Error("offline");
				delivered.push(JSON.parse(opts.body));
				return { ok: true };
			},
		},
	);
	await listeners.visit({
		url: "https://example.com/",
		title: "Example",
		lastVisitTime: 1000,
	});
	expect(state.queue).toHaveLength(1);
	expect(delivered).toHaveLength(0);
	online = true;
	await listeners.alarm();
	expect(state.queue).toHaveLength(0);
	expect(delivered).toHaveLength(1);
	await listeners.alarm();
	expect(delivered).toHaveLength(1);
	state.recording = false;
	await listeners.visit({
		url: "https://example.org/",
		title: "Paused",
		lastVisitTime: 2000,
	});
	expect(delivered).toHaveLength(1);
});
