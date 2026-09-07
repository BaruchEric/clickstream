import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canonical,
	clusters,
	day,
	event,
	open,
	put,
	type Store,
} from "../src/core";
import {
	chromiumTime,
	detect,
	firefoxTime,
	ingestBrowser,
	ingestTakeout,
	safariTime,
} from "../src/ingest";
import { exportShard, importShards } from "../src/sync";

const roots: string[] = [];
const stores: Store[] = [];
function temp() {
	const p = mkdtempSync(join(tmpdir(), "chronicle-test-"));
	roots.push(p);
	return p;
}
function store() {
	const s = open(temp());
	stores.push(s);
	return s;
}
afterEach(() => {
	for (const s of stores.splice(0)) s.db.close();
	for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const ts = Date.parse("2024-01-01T00:00:00Z");
const sample = (source = "chrome", time = ts) =>
	event({
		source,
		kind: "page_view",
		ts: time,
		title: "Example activity",
		url: "https://example.com/page?utm_source=x",
		duration_ms: null,
		meta: "{}",
	});
test("epochs: Chromium, Firefox, Safari and ISO", () => {
	expect(chromiumTime(13348540800000000)).toBe(ts);
	expect(firefoxTime(1704067200000000)).toBe(ts);
	expect(safariTime(725760000)).toBe(ts);
	expect(Date.parse("2024-01-01T00:00:00Z")).toBe(ts);
});
test("canonical URL retains video id and removes tracking", () =>
	expect(canonical("https://YouTube.com/watch?v=abc&si=x&utm_source=y#x")).toBe(
		"https://youtube.com/watch?v=abc",
	));
for (const source of ["chrome", "edge", "brave", "arc", "firefox", "safari"])
	test(`${source} locked WAL fixture and repeat ingestion`, () => {
		const s = store(),
			path = join(temp(), "History");
		const db = new Database(path);
		db.exec("PRAGMA journal_mode=WAL");
		if (source === "firefox")
			db.exec(
				`CREATE TABLE moz_places(id INTEGER,url TEXT,title TEXT);CREATE TABLE moz_historyvisits(id INTEGER,place_id INTEGER,visit_date INTEGER);INSERT INTO moz_places VALUES(1,'https://example.com','Firefox');INSERT INTO moz_historyvisits VALUES(1,1,1704067200000000)`,
			);
		else if (source === "safari")
			db.exec(
				`CREATE TABLE history_items(id INTEGER,url TEXT);CREATE TABLE history_visits(id INTEGER,history_item INTEGER,visit_time REAL,title TEXT);INSERT INTO history_items VALUES(1,'https://example.com');INSERT INTO history_visits VALUES(1,1,725760000,'Safari')`,
			);
		else
			db.exec(
				`CREATE TABLE urls(id INTEGER,url TEXT,title TEXT);CREATE TABLE visits(id INTEGER,url INTEGER,visit_time INTEGER,visit_duration INTEGER);INSERT INTO urls VALUES(1,'https://example.com','Chromium');INSERT INTO visits VALUES(1,1,13348540800000000,5000000)`,
			);
		try {
			expect(ingestBrowser(s, { source, path }).added).toBe(1);
			expect(ingestBrowser(s, { source, path }).added).toBe(0);
			const row = clusters(s)[0];
			expect(row.ts).toBe(ts);
			expect(row.duration_ms).toBe(
				["firefox", "safari"].includes(source) ? null : 5000,
			);
		} finally {
			db.close();
		}
	});
test("Takeout junk, overlap, channels and cross-source clustering", () => {
	const s = store(),
		dir = temp();
	put(s, sample(), { id: "a", name: "Laptop" });
	writeFileSync(
		join(dir, "MyActivity.json"),
		JSON.stringify([
			{
				header: "Chrome",
				title: "Visited Example activity",
				titleUrl: "https://example.com/page",
				time: "2024-01-01T00:00:40Z",
			},
			{
				header: "Search",
				title: "Searched for Example",
				titleUrl: "https://google.com/search?q=Example",
				time: "2024-01-01T00:02:00Z",
			},
		]),
	);
	writeFileSync(
		join(dir, "watch-history.json"),
		JSON.stringify([
			{
				title: "Watched Example video",
				titleUrl: "https://youtube.com/watch?v=abc",
				time: "2024-01-01T01:00:00Z",
				subtitles: [{ name: "Example channel" }],
			},
			{ title: "Watched Deleted video", time: "2024-01-01T02:00:00Z" },
			{
				title: "Watched Ad",
				time: "2024-01-01T03:00:00Z",
				details: [{ name: "From Google Ads" }],
			},
		]),
	);
	expect(ingestTakeout(s, dir)).toEqual({ google_activity: 2, youtube: 2 });
	expect(ingestTakeout(s, dir)).toEqual({ google_activity: 0, youtube: 0 });
	const c = clusters(s).find(
		(e) => e.canonical_url === "https://example.com/page",
	);
	expect(c?.ts).toBe(ts);
	expect(c?.also_seen_in).toEqual(["chrome", "google_activity"]);
	expect(clusters(s, { query: "Example" }).length).toBe(3);
	expect(clusters(s).find((e) => e.title === "Deleted video")?.url).toBeNull();
});
test("sync round trip and replicated visit attribution", () => {
	const a = store(),
		b = store(),
		c = store(),
		shared = temp();
	put(a, sample(), a.device);
	put(b, sample(), b.device);
	expect(exportShard(a, shared).exported).toBe(1);
	expect(exportShard(a, shared).exported).toBe(0);
	exportShard(b, shared);
	expect(importShards(c, shared).added).toBe(1);
	expect(clusters(c)[0].devices).toHaveLength(2);
	expect(importShards(c, shared).added).toBe(0);
});
test("reverse shard import yields byte-identical timeline and devices including hash collisions", () => {
	const a = store(),
		b = store(),
		shared = temp();
	put(a, sample(), a.device);
	put(b, { ...sample("google_activity"), title: "Different title" }, b.device);
	exportShard(a, shared);
	exportShard(b, shared);
	const x = store(),
		y = store(),
		one = temp(),
		two = temp();
	const af = readFileSync(join(shared, `${a.device.id}.ndjson`)),
		bf = readFileSync(join(shared, `${b.device.id}.ndjson`));
	writeFileSync(join(one, "a.ndjson"), af);
	writeFileSync(join(two, "b.ndjson"), bf);
	importShards(x, one);
	importShards(x, two);
	importShards(y, two);
	importShards(y, one);
	expect(JSON.stringify(clusters(x))).toBe(JSON.stringify(clusters(y)));
	expect(x.db.query("SELECT * FROM devices ORDER BY id").all()).toEqual(
		y.db.query("SELECT * FROM devices ORDER BY id").all(),
	);
});
test("greedy cluster uses first timestamp and preserves kinds", () => {
	const s = store();
	for (const t of [0, 100, 200])
		put(s, sample("chrome", ts + t * 1000), s.device);
	expect(clusters(s)).toHaveLength(2);
	put(s, event({ ...sample(), kind: "search" }), s.device);
	expect(clusters(s)).toHaveLength(3);
});
test("all profiles detected and local day boundaries", () => {
	const root = temp();
	for (const name of ["Default", "Profile 1"]) {
		const p = join(root, "Library/Application Support/Google/Chrome", name);
		mkdirSync(p, { recursive: true });
		writeFileSync(join(p, "History"), "");
	}
	expect(
		detect("darwin", root).filter((p) => p.source === "chrome"),
	).toHaveLength(2);
	expect(new Date(day("2024-01-01").since).getHours()).toBe(0);
});
