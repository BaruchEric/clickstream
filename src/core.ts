import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export type Event = {
	id: string;
	source: string;
	kind: string;
	ts: number;
	title: string | null;
	url: string | null;
	canonical_url: string;
	domain: string | null;
	duration_ms: number | null;
	meta: string;
};
export const sources = [
	"chrome",
	"edge",
	"brave",
	"arc",
	"safari",
	"firefox",
	"google_activity",
	"youtube",
	"manual",
];
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function canonical(url: string | null) {
	if (!url) return "";
	try {
		const u = new URL(url);
		u.hash = "";
		for (const k of [...u.searchParams.keys()])
			if (
				/^utm_/i.test(k) ||
				["gclid", "fbclid", "si"].includes(k.toLowerCase())
			)
				u.searchParams.delete(k);
		u.searchParams.sort();
		return u.href;
	} catch {
		return url;
	}
}
export function event(
	input: Omit<Event, "id" | "canonical_url" | "domain">,
): Event {
	const c =
		(input.source === "manual"
			? `manual:${JSON.parse(input.meta).manual_id}`
			: "") ||
		canonical(input.url) ||
		`unavailable:${hash(input.title || "Deleted video")}`;
	let domain = null;
	try {
		domain = new URL(input.url || c).hostname;
	} catch {}
	return {
		...input,
		canonical_url: c,
		domain,
		id: hash(`${input.kind}|${c}|${Math.floor(input.ts / 1000)}`),
	};
}
export function open(
	home = process.env.CHRONICLE_HOME || join(homedir(), ".chronicle"),
) {
	mkdirSync(home, { recursive: true, mode: 0o700 });
	chmodSync(home, 0o700);
	const config = join(home, "config.json");
	if (!existsSync(config))
		writeFileSync(
			config,
			JSON.stringify({
				id: randomUUID(),
				name: process.env.COMPUTERNAME || process.env.HOSTNAME || "My device",
			}),
			{ mode: 0o600 },
		);
	const device = JSON.parse(readFileSync(config, "utf8")) as {
		id: string;
		name: string;
	};
	const db = new Database(join(home, "chronicle.db"));
	chmodSync(join(home, "chronicle.db"), 0o600);
	db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,source TEXT NOT NULL,kind TEXT NOT NULL,ts INTEGER NOT NULL,title TEXT,url TEXT,canonical_url TEXT NOT NULL,domain TEXT,duration_ms INTEGER,meta TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts); CREATE INDEX IF NOT EXISTS events_domain ON events(domain); CREATE INDEX IF NOT EXISTS events_source ON events(source);
CREATE TABLE IF NOT EXISTS event_devices(event_id TEXT NOT NULL REFERENCES events(id),device_id TEXT NOT NULL,PRIMARY KEY(event_id,device_id));
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sync(source TEXT PRIMARY KEY,watermark INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS observations(key TEXT PRIMARY KEY,event_id TEXT NOT NULL,payload TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(title,canonical_url,content='events',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN INSERT INTO event_fts(rowid,title,canonical_url) VALUES(new.rowid,new.title,new.canonical_url); END;
CREATE VIRTUAL TABLE IF NOT EXISTS observation_fts USING fts5(event_id UNINDEXED,title,canonical_url);
`);
	return { db, device, home };
}
export type Store = ReturnType<typeof open>;
export function put(
	s: Store,
	e: Event,
	device: { id: string; name: string },
	seen = e.ts,
) {
	if (
		!Number.isFinite(e.ts) ||
		e.ts < 0 ||
		!sources.includes(e.source) ||
		!["page_view", "search", "video_watch", "manual_event"].includes(e.kind) ||
		event(e).id !== e.id
	)
		throw Error("Invalid event");
	const payload = JSON.stringify(
		Object.fromEntries(
			Object.entries(e).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
	s.db
		.query(
			"INSERT OR IGNORE INTO events VALUES($id,$source,$kind,$ts,$title,$url,$canonical_url,$domain,$duration_ms,$meta)",
		)
		.run(Object.fromEntries(Object.entries(e).map(([k, v]) => [`$${k}`, v])))
		.changes;
	const added = (s.db.query("SELECT changes() AS n").get() as { n: number }).n;
	s.db
		.query("INSERT OR IGNORE INTO event_devices VALUES(?,?)")
		.run(e.id, device.id);
	s.db
		.query(
			"INSERT INTO devices VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=min(name,excluded.name),last_seen=max(last_seen,excluded.last_seen)",
		)
		.run(device.id, device.name, seen);
	const obs = s.db
		.query("INSERT OR IGNORE INTO observations VALUES(?,?,?)")
		.run(hash(payload), e.id, payload);
	if (obs.changes)
		s.db
			.query("INSERT INTO observation_fts VALUES(?,?,?)")
			.run(e.id, e.title, e.canonical_url);
	return added > 0 ? 1 : 0;
}
export type Cluster = Event & {
	also_seen_in: string[];
	devices: string[];
	members: string[];
};
export type Filter = {
	query?: string;
	since?: number;
	until?: number;
	source?: string;
	device?: string;
	window?: number;
};
export function clusters(s: Store, f: Filter = {}): Cluster[] {
	const rows = s.db
		.query("SELECT payload FROM observations ORDER BY event_id,key")
		.all() as { payload: string }[];
	const associations = s.db
		.query("SELECT event_id,device_id FROM event_devices ORDER BY device_id")
		.all() as { event_id: string; device_id: string }[];
	const dm = new Map<string, string[]>();
	for (const d of associations)
		dm.set(d.event_id, [...(dm.get(d.event_id) || []), d.device_id]);
	const groups = new Map<string, Event[]>();
	for (const r of rows) {
		const e = JSON.parse(r.payload) as Event;
		const key = `${e.kind}|${e.canonical_url}`;
		const group = groups.get(key);
		if (group) group.push(e);
		else groups.set(key, [e]);
	}
	let hits: Set<string> | undefined;
	if (f.query)
		hits = new Set(
			(
				s.db
					.query(
						"SELECT event_id FROM observation_fts WHERE observation_fts MATCH ?",
					)
					.all(f.query) as { event_id: string }[]
			).map((r) => r.event_id),
		);
	const result: Cluster[] = [];
	const rank = (e: Event) => sources.indexOf(e.source);
	for (const g of groups.values()) {
		g.sort(
			(a, b) => a.ts - b.ts || a.id.localeCompare(b.id) || rank(a) - rank(b),
		);
		for (let i = 0; i < g.length; ) {
			const start = g[i].ts;
			const members: Event[] = [];
			while (i < g.length && g[i].ts - start <= (f.window ?? 120) * 1000)
				members.push(g[i++]);
			members.sort(
				(a, b) =>
					rank(a) - rank(b) ||
					a.ts - b.ts ||
					JSON.stringify(a).localeCompare(JSON.stringify(b)),
			);
			const e = members[0];
			const devices = [
				...new Set(members.flatMap((m) => dm.get(m.id) || [])),
			].sort();
			if (
				(f.since !== undefined && e.ts < f.since) ||
				(f.until !== undefined && e.ts >= f.until) ||
				(f.source && !members.some((m) => m.source === f.source)) ||
				(f.device && !devices.includes(f.device)) ||
				(hits && !members.some((m) => hits.has(m.id)))
			)
				continue;
			result.push({
				...e,
				also_seen_in: [...new Set(members.map((m) => m.source))].sort(),
				devices,
				members: [...new Set(members.map((m) => m.id))].sort(),
			});
		}
	}
	return result.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}
export function since(value: string) {
	const m = /^(\d+)d$/.exec(value);
	if (!m) throw Error("Expected duration like 7d");
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - Number(m[1]));
	return +d;
}
export function day(value: string) {
	const d =
		value === "today" || value === "yesterday"
			? new Date()
			: new Date(`${value}T00:00:00`);
	if (!Number.isFinite(+d)) throw Error("Invalid day");
	d.setHours(0, 0, 0, 0);
	if (value === "yesterday") d.setDate(d.getDate() - 1);
	const end = new Date(d);
	end.setDate(end.getDate() + 1);
	return { since: +d, until: +end };
}
export function stats(rows: Cluster[]) {
	const count = (get: (r: Cluster) => string[]) => {
		const m = new Map<string, number>();
		for (const r of rows)
			for (const key of get(r)) m.set(key, (m.get(key) || 0) + 1);
		return [...m]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 20);
	};
	return {
		entries: rows.length,
		domains: count((r) => (r.domain ? [r.domain] : [])),
		channels: count((r) => {
			try {
				const m = JSON.parse(r.meta);
				return m.channel ? [m.channel] : [];
			} catch {
				return [];
			}
		}),
		devices: count((r) => r.devices),
	};
}
