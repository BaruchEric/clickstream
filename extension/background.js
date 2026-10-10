const ENDPOINT = "http://127.0.0.1:4400/api/extension";
let chain = Promise.resolve();
const serial = (fn) => {
	const next = chain.then(fn);
	chain = next.catch(() => {});
	return next;
};
async function enqueue(item) {
	const { queue = [] } = await chrome.storage.local.get("queue");
	if (queue.length >= 3000)
		throw Error("Queue full. Start Chronicle and sync before capturing more.");
	queue.push(item);
	await chrome.storage.local.set({ queue });
}
async function flush() {
	const { token, queue = [] } = await chrome.storage.local.get([
		"token",
		"queue",
	]);
	if (!token || !queue.length) return;
	let sent = 0;
	for (const item of queue.slice(0, 100)) {
		try {
			const response = await fetch(ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(item),
				signal: AbortSignal.timeout(10000),
			});
			if (!response.ok) throw Error(await response.text());
			sent++;
		} catch (e) {
			await chrome.storage.local.set({ error: e.message });
			break;
		}
	}
	await chrome.storage.local.set({
		queue: queue.slice(sent),
		...(sent ? { lastSync: Date.now() } : {}),
		...(sent === queue.length ? { error: "" } : {}),
	});
}
chrome.runtime.onInstalled.addListener(() => {
	chrome.alarms.create("sync", { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
	chrome.alarms.create("sync", { periodInMinutes: 1 });
	serial(flush);
});
chrome.alarms.onAlarm.addListener(() => serial(flush));
chrome.history.onVisited.addListener((item) =>
	serial(async () => {
		const { recording } = await chrome.storage.local.get("recording");
		if (!recording || !item.url || !/^https?:\/\//i.test(item.url)) return;
		await enqueue({
			type: "visit",
			url: item.url,
			title: (item.title || "").slice(0, 1000),
			ts: item.lastVisitTime || Date.now(),
		});
		await flush();
	}).catch((e) => chrome.storage.local.set({ error: e.message })),
);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
	if (sender.id !== chrome.runtime.id) return;
	serial(async () => {
		if (message.action === "capture") {
			await enqueue(message.capture);
			await flush();
		} else if (message.action === "sync") await flush();
		else if (message.action === "settings") {
			await chrome.storage.local.set({
				token: message.token,
				recording: !!message.recording,
			});
			await flush();
		} else throw Error("Unknown action");
		return { ok: true };
	}).then(reply, (e) => reply({ error: e.message }));
	return true;
});
