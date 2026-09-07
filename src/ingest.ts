import { Database } from "bun:sqlite";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { event, put, type Store } from "./core";
export const chromiumTime = (n: number) =>
	Math.floor(n / 1000 - 11644473600000);
export const firefoxTime = (n: number) => Math.floor(n / 1000);
export const safariTime = (n: number) => Math.floor((n + 978307200) * 1000);
export type Profile = { source: string; path: string };
function dirs(p: string) {
	try {
		return readdirSync(p, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => join(p, e.name));
	} catch {
		return [];
	}
}
export function detect(
	platform = process.platform,
	home = homedir(),
	env = process.env,
): Profile[] {
	const out: Profile[] = [];
	const add = (source: string, root: string, file = "History") => {
		for (const p of dirs(root)) {
			const path = join(p, file);
			if (existsSync(path)) out.push({ source, path });
		}
	};
	const windows = (local: string, roaming: string) => {
		for (const [s, p] of [
			["chrome", "Google/Chrome"],
			["edge", "Microsoft/Edge"],
			["brave", "BraveSoftware/Brave-Browser"],
		])
			add(s, join(local, p, "User Data"));
		add("firefox", join(roaming, "Mozilla/Firefox/Profiles"), "places.sqlite");
	};
	if (platform === "darwin") {
		for (const [s, p] of [
			["chrome", "Google/Chrome"],
			["edge", "Microsoft Edge"],
			["brave", "BraveSoftware/Brave-Browser"],
			["arc", "Arc/User Data"],
		])
			add(s, join(home, "Library/Application Support", p));
		add(
			"firefox",
			join(home, "Library/Application Support/Firefox/Profiles"),
			"places.sqlite",
		);
		const path = join(home, "Library/Safari/History.db");
		if (existsSync(path)) out.push({ source: "safari", path });
	} else if (platform === "win32") {
		if (env.LOCALAPPDATA && env.APPDATA) windows(env.LOCALAPPDATA, env.APPDATA);
	} else {
		for (const [s, p] of [
			["chrome", "google-chrome"],
			["edge", "microsoft-edge"],
			["brave", "BraveSoftware/Brave-Browser"],
		])
			add(s, join(env.XDG_CONFIG_HOME || join(home, ".config"), p));
		add("firefox", join(home, ".mozilla/firefox"), "places.sqlite");
		if (existsSync("/mnt/c"))
			for (const user of dirs("/mnt/c/Users"))
				windows(join(user, "AppData/Local"), join(user, "AppData/Roaming"));
	}
	return out;
}
export function ingestBrowser(s: Store, p: Profile) {
	const temp = mkdtempSync(join(tmpdir(), "chronicle-"));
	let original: Database | undefined;
	let snapshot: Database | undefined;
	try {
		original = new Database(p.path, { readonly: true });
		original.exec("PRAGMA busy_timeout=5000");
		original.query("VACUUM INTO ?").run(join(temp, "snapshot.db"));
		original.close();
		original = undefined;
		snapshot = new Database(join(temp, "snapshot.db"), { readonly: true });
		const key = `${p.source}:${p.path}`;
		const watermark =
			(
				s.db.query("SELECT watermark FROM sync WHERE source=?").get(key) as {
					watermark: number;
				} | null
			)?.watermark || 0;
		let sql: string;
		let convert: (n: number) => number;
		if (p.source === "firefox") {
			sql =
				"SELECT v.id AS visit_id,v.visit_date AS time,p.url,p.title,NULL AS duration FROM moz_historyvisits v JOIN moz_places p ON p.id=v.place_id WHERE v.id>? ORDER BY v.id";
			convert = firefoxTime;
		} else if (p.source === "safari") {
			sql =
				"SELECT v.id AS visit_id,v.visit_time AS time,p.url,v.title,NULL AS duration FROM history_visits v JOIN history_items p ON p.id=v.history_item WHERE v.id>? ORDER BY v.id";
			convert = safariTime;
		} else {
			const columns = snapshot.query("PRAGMA table_info(visits)").all() as {
				name: string;
			}[];
			sql = `SELECT v.id AS visit_id,v.visit_time AS time,u.url,u.title,${columns.some((c) => c.name === "visit_duration") ? "v.visit_duration" : "NULL"} AS duration FROM visits v JOIN urls u ON u.id=v.url WHERE v.id>? ORDER BY v.id`;
			convert = chromiumTime;
		}
		const rows = snapshot.query(sql).all(watermark) as {
			visit_id: number;
			time: number;
			url: string;
			title: string | null;
			duration: number | null;
		}[];
		let added = 0;
		let last = watermark;
		s.db.transaction(() => {
			for (const r of rows) {
				added += put(
					s,
					event({
						source: p.source,
						kind: "page_view",
						ts: convert(r.time),
						title: r.title,
						url: r.url,
						duration_ms:
							r.duration === null ? null : Math.floor(r.duration / 1000),
						meta: "{}",
					}),
					s.device,
				);
				last = Math.max(last, r.visit_id);
			}
			s.db
				.query(
					"INSERT INTO sync VALUES(?,?) ON CONFLICT(source) DO UPDATE SET watermark=excluded.watermark",
				)
				.run(key, last);
		})();
		return { source: p.source, added, read: rows.length };
	} finally {
		original?.close();
		snapshot?.close();
		rmSync(temp, { recursive: true, force: true });
	}
}
type Activity = {
	header?: string;
	title?: string;
	titleUrl?: string;
	time: string;
	details?: { name: string }[];
	subtitles?: { name: string; url?: string }[];
};
export function ingestTakeout(s: Store, path: string, selected?: string) {
	const files: string[] = [];
	const walk = (p: string) => {
		if (p.toLowerCase().endsWith(".json")) files.push(p);
		else
			for (const entry of readdirSync(p, { withFileTypes: true })) {
				if (entry.isSymbolicLink()) continue;
				if (entry.isDirectory() || entry.name.endsWith(".json"))
					walk(join(p, entry.name));
			}
	};
	walk(path);
	const totals: Record<string, number> = {};
	for (const file of files) {
		if (!/myactivity\.json$|watch-history\.json$/i.test(file)) continue;
		const youtube = /watch-history\.json$/i.test(file);
		const source = youtube ? "youtube" : "google_activity";
		if (selected && selected !== source) continue;
		const rows = JSON.parse(readFileSync(file, "utf8")) as Activity[];
		if (!Array.isArray(rows)) throw Error(`Expected JSON array: ${file}`);
		s.db.transaction(() => {
			totals[source] ??= 0;
			for (const r of rows) {
				if (r.details?.some((d) => d.name === "From Google Ads")) continue;
				const ts = Date.parse(r.time);
				if (!Number.isFinite(ts)) continue;
				const title = (r.title || "Deleted video").replace(
					youtube ? /^Watched / : /^Visited /,
					"",
				);
				let videoId: string | undefined;
				try {
					videoId =
						new URL(r.titleUrl || "").searchParams.get("v") || undefined;
				} catch {}
				totals[source] += put(
					s,
					event({
						source,
						kind: youtube
							? "video_watch"
							: r.header === "Search" || /^Searched for /.test(title)
								? "search"
								: "page_view",
						ts,
						title,
						url: r.titleUrl || null,
						duration_ms: null,
						meta: JSON.stringify({
							video_id: videoId,
							channel: r.subtitles?.[0]?.name,
						}),
					}),
					s.device,
				);
			}
		})();
	}
	return totals;
}
export const ingesters = [
	"chrome",
	"edge",
	"brave",
	"arc",
	"firefox",
	"safari",
].map((name) => ({
	name,
	platforms:
		name === "safari" || name === "arc"
			? ["darwin"]
			: ["darwin", "linux", "win32"],
	detect: () => detect().filter((p) => p.source === name),
	ingest: ingestBrowser,
}));
