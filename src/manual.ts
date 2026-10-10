import { event, put, type Store } from "./core";
import { saveNote, setup } from "./curation";
export function createManualEvent(s: Store, input: Record<string, unknown>) {
	setup(s);
	if (
		typeof input.id !== "string" ||
		!/^[0-9a-f-]{36}$/i.test(input.id) ||
		typeof input.title !== "string" ||
		!input.title.trim() ||
		input.title.length > 1000 ||
		typeof input.ts !== "number" ||
		!Number.isFinite(input.ts) ||
		input.ts < 0 ||
		input.ts > 8640000000000000
	)
		throw Error("A title and valid date are required");
	let url: string | null = null;
	if (input.url) {
		if (typeof input.url !== "string" || input.url.length > 8000)
			throw Error("Invalid link");
		const parsed = new URL(input.url);
		if (!["http:", "https:"].includes(parsed.protocol))
			throw Error("Use an http or https link");
		url = parsed.href;
	}
	const existing = s.db
		.query("SELECT id,canonical_url FROM events WHERE canonical_url=?")
		.get(`manual:${input.id}`) as { id: string; canonical_url: string } | null;
	if (existing) return existing;
	const e = event({
		source: "manual",
		kind: "manual_event",
		ts: input.ts,
		title: input.title.trim(),
		url,
		duration_ms: null,
		meta: JSON.stringify({ manual_id: input.id }),
	});
	s.db.transaction(() => {
		put(s, e, s.device);
		saveNote(s, {
			canonical_url: e.canonical_url,
			title: e.title,
			body: input.body ?? "",
			next_step: input.next_step ?? "",
			status: input.status ?? "saved",
			tags: input.tags ?? [],
			excluded_tags: [],
		});
	})();
	return { id: e.id, canonical_url: e.canonical_url };
}
