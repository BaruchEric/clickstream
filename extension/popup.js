const el = (id) => document.getElementById(id);
let page = null;
async function status() {
	const s = await chrome.storage.local.get([
		"token",
		"recording",
		"queue",
		"error",
		"lastSync",
	]);
	el("token").value = s.token || "";
	el("recording").checked = !!s.recording;
	el("status").textContent =
		`${s.queue?.length || 0} queued events. ${s.error || ""}`;
}
async function send(message) {
	const result = await chrome.runtime.sendMessage(message);
	if (result.error) throw Error(result.error);
	await status();
}
function action(id, fn) {
	el(id).onclick = async () => {
		el(id).disabled = true;
		try {
			await fn();
		} catch (e) {
			el("status").textContent = e.message;
		} finally {
			el(id).disabled = false;
		}
	};
}
action("settings", () =>
	send({
		action: "settings",
		token: el("token").value.trim(),
		recording: el("recording").checked,
	}),
);
action("sync", () => send({ action: "sync" }));
action("preview", async () => {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id || !/^https?:\/\//i.test(tab.url || "") || tab.incognito)
		throw Error("Open a normal web page first.");
	const [result] = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const selected = window.getSelection()?.toString() || "";
			const root =
				document.querySelector("article, main, [role=main]") || document.body;
			const copy = root.cloneNode(true);
			for (const n of copy.querySelectorAll(
				"script,style,noscript,input,textarea,select,form,[contenteditable],nav,header,footer,[hidden],[aria-hidden=true]",
			))
				n.remove();
			return {
				title: document.title,
				url: location.href,
				content: (selected || copy.textContent || "")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 40000),
			};
		},
	});
	page = result.result;
	if (!page.content)
		throw Error("No readable text. Try selecting the passage you want.");
	el("content").value = page.content;
	el("capture").hidden = false;
});
async function capture(digest) {
	if (!page) throw Error("Preview a page first");
	if (!el("content").value.trim()) throw Error("Capture is empty");
	await send({
		action: "capture",
		capture: {
			...page,
			content: el("content").value.slice(0, 40000),
			type: "capture",
			id: crypto.randomUUID(),
			ts: Date.now(),
			digest,
		},
	});
	el("capture").hidden = true;
	page = null;
}
action("save", () => capture(false));
action("digest", () => capture(true));
status();
