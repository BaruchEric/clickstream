import { type Cluster, clusters, type Store, since } from "./core";
import { normalizeTags, smartTags } from "./tags";
export function setup(s: Store) {
	s.db.exec(
		`CREATE TABLE IF NOT EXISTS notes(canonical_url TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',next_step TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'saved',updated INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS muted_domains(domain TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS activity_tags(canonical_url TEXT PRIMARY KEY,custom TEXT NOT NULL,excluded TEXT NOT NULL);`,
	);
}
export type Note = {
	canonical_url: string;
	title: string;
	body: string;
	next_step: string;
	status: string;
	updated: number;
};
export function saveNote(s: Store, input: Record<string, unknown>) {
	const { canonical_url, title, body, next_step, status } = input;
	if (
		typeof canonical_url !== "string" ||
		typeof title !== "string" ||
		typeof body !== "string" ||
		typeof next_step !== "string" ||
		!["saved", "explore", "done"].includes(String(status)) ||
		title.length > 1000 ||
		body.length > 50000 ||
		next_step.length > 10000
	)
		throw Error("Invalid note");
	if (
		!s.db.query("SELECT 1 FROM events WHERE canonical_url=?").get(canonical_url)
	)
		throw Error("Activity no longer available");
	const custom = input.tags === undefined ? null : normalizeTags(input.tags);
	const excluded =
		input.excluded_tags === undefined
			? null
			: normalizeTags(input.excluded_tags);
	s.db.transaction(() => {
		s.db
			.query(
				"INSERT INTO notes VALUES(?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET title=excluded.title,body=excluded.body,next_step=excluded.next_step,status=excluded.status,updated=excluded.updated",
			)
			.run(canonical_url, title, body, next_step, String(status), Date.now());
		if (custom !== null || excluded !== null) {
			const previous = s.db
				.query(
					"SELECT custom,excluded FROM activity_tags WHERE canonical_url=?",
				)
				.get(canonical_url) as { custom: string; excluded: string } | null;
			s.db
				.query(
					"INSERT INTO activity_tags VALUES(?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET custom=excluded.custom,excluded=excluded.excluded",
				)
				.run(
					canonical_url,
					custom === null ? previous?.custom || "[]" : JSON.stringify(custom),
					excluded === null
						? previous?.excluded || "[]"
						: JSON.stringify(excluded),
				);
		}
	})();
}
export function noiseReason(row: Cluster) {
	if (row.url && !/^https?:\/\//i.test(row.url))
		return "Browser or internal page";
	try {
		const u = new URL(row.canonical_url);
		if (
			/(^|\.)(accounts\.google\.com|login\.microsoftonline\.com)$/.test(
				u.hostname,
			) ||
			/^\/(login|signin|sign-in|logout|oauth|authorize|callback)(\/|$)/i.test(
				u.pathname,
			)
		)
			return "Sign-in or redirect page";
		if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))
			return "Local app or development page";
	} catch {}
	return "";
}
export function curated(s: Store, p: URLSearchParams) {
	setup(s);
	const period = p.get("period") || "";
	if (period && !["7d", "30d", "90d"].includes(period))
		throw Error("Invalid date range");
	const all = clusters(s, {
		source: p.get("source") || undefined,
		device: p.get("device") || undefined,
		since: period ? since(period) : undefined,
	});
	const notes = new Map(
		(s.db.query("SELECT * FROM notes").all() as Note[]).map((n) => [
			n.canonical_url,
			n,
		]),
	);
	const tagSettings = new Map(
		(
			s.db.query("SELECT * FROM activity_tags").all() as {
				canonical_url: string;
				custom: string;
				excluded: string;
			}[]
		).map((r) => [r.canonical_url, r]),
	);
	const muted = (
		s.db.query("SELECT domain FROM muted_domains ORDER BY domain").all() as {
			domain: string;
		}[]
	).map((r) => r.domain);
	const mutedSet = new Set(muted);
	const seen = new Set<string>();
	let hidden = 0;
	const q = (p.get("q") || "").toLowerCase();
	const domain = (p.get("domain") || "").trim().toLowerCase();
	const view = p.get("view") || "activity";
	const rows = [];
	for (const r of all) {
		const note = notes.get(r.canonical_url) || null;
		const setting = tagSettings.get(r.canonical_url);
		const custom_tags: string[] = JSON.parse(setting?.custom || "[]");
		const excluded_tags: string[] = JSON.parse(setting?.excluded || "[]");
		const auto_tags = smartTags(r, note);
		const tags = [
			...new Set([
				...auto_tags.filter((t) => !excluded_tags.includes(t)),
				...custom_tags,
			]),
		].sort();
		const local = new Date(r.ts);
		const key = `${local.getFullYear()}-${local.getMonth()}-${local.getDate()}|${r.kind}|${r.canonical_url}`;
		const reason = mutedSet.has(r.domain || "")
			? "Muted domain"
			: noiseReason(r) || (seen.has(key) ? "Repeat visit on the same day" : "");
		seen.add(key);
		if (
			q &&
			!`${r.title} ${r.canonical_url} ${note?.body || ""} ${note?.next_step || ""} ${note?.title || ""} ${tags.join(" ")}`
				.toLowerCase()
				.includes(q)
		)
			continue;
		if (domain && r.domain !== domain && !r.domain?.endsWith(`.${domain}`))
			continue;
		if (p.get("kind") && r.kind !== p.get("kind")) continue;
		if (
			(view === "saved" && !note) ||
			(view === "explore" && note?.status !== "explore")
		)
			continue;
		if (view === "activity" && p.get("noise") !== "off" && reason && !note) {
			hidden++;
			continue;
		}
		rows.push({
			...r,
			note,
			noise_reason: reason,
			tags,
			auto_tags,
			custom_tags,
			excluded_tags,
		});
	}
	const unique = new Set<string>();
	const collection =
		view === "activity"
			? rows
			: rows.filter((r) => {
					if (unique.has(r.canonical_url)) return false;
					unique.add(r.canonical_url);
					return true;
				});
	if (view !== "activity")
		collection.sort(
			(a, b) =>
				(b.note?.updated || 0) - (a.note?.updated || 0) ||
				b.ts - a.ts ||
				a.id.localeCompare(b.id),
		);
	const counts = new Map<string, number>();
	for (const row of collection)
		for (const tag of row.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
	const tag_counts = [...counts].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	);
	const selectedTag = (p.get("tag") || "")
		.trim()
		.toLowerCase()
		.replace(/^#/, "");
	return {
		rows: collection.filter(
			(r) => !selectedTag || r.tags.includes(selectedTag),
		),
		hidden,
		muted,
		tag_counts,
	};
}
export function markdown(rows: ReturnType<typeof curated>["rows"]) {
	return (
		"# Chronicle log\n\n" +
		rows
			.map(
				(r) =>
					`## ${(r.note?.title || r.title || "Untitled").replace(/\n/g, " ")}\n\n${new Date(r.ts).toISOString()} · ${r.also_seen_in.join(", ")}\n\n${r.url && /^https?:\/\//i.test(r.url) ? `Source: <${r.url.replace(/[<>\r\n]/g, "")}>\n\n` : ""}${r.tags.length ? `Tags: ${r.tags.map((t) => `#${t}`).join(", ")}\n\n` : ""}${r.note?.body || ""}${r.note?.next_step ? `\n\nNext step: ${r.note.next_step}` : ""}${r.note ? `\n\nStatus: ${r.note.status}` : ""}\n`,
			)
			.join("\n")
	);
}
