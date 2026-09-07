import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { type Event, hash, put, type Store } from "./core";

type RecordRow = {
	version: 1;
	event: Event;
	device: { id: string; name: string };
	seen: number;
};
function parse(line: string): RecordRow {
	const r = JSON.parse(line);
	if (
		r.version !== 1 ||
		!r.event ||
		typeof r.device?.id !== "string" ||
		typeof r.device?.name !== "string" ||
		!Number.isFinite(r.seen)
	)
		throw Error("Invalid shard record");
	return r;
}
export function exportShard(s: Store, shared: string) {
	mkdirSync(shared, { recursive: true, mode: 0o700 });
	const file = join(shared, `${s.device.id}.ndjson`);
	const lock = `${file}.lock`;
	const fd = openSync(lock, "wx", 0o600);
	try {
		const contents = existsSync(file) ? readFileSync(file, "utf8") : "";
		if (contents && !contents.endsWith("\n"))
			throw Error(
				"Shard has an incomplete final line; restore it before exporting",
			);
		const known = new Set(
			contents
				.split("\n")
				.filter(Boolean)
				.map((l) => hash(l)),
		);
		const rows = s.db
			.query(
				"SELECT o.payload,d.id,d.name,d.last_seen FROM observations o JOIN event_devices ed ON ed.event_id=o.event_id JOIN devices d ON d.id=ed.device_id WHERE d.id=? ORDER BY o.key",
			)
			.all(s.device.id) as {
			payload: string;
			id: string;
			name: string;
			last_seen: number;
		}[];
		let added = 0;
		for (const row of rows) {
			const e = JSON.parse(row.payload) as Event;
			const line = JSON.stringify({
				version: 1,
				event: e,
				device: { id: row.id, name: row.name },
				seen: e.ts,
			});
			if (known.has(hash(line))) continue;
			appendFileSync(file, `${line}\n`, { mode: 0o600 });
			known.add(hash(line));
			added++;
		}
		if (!existsSync(file)) appendFileSync(file, "", { mode: 0o600 });
		return { file, exported: added };
	} finally {
		closeSync(fd);
		unlinkSync(lock);
	}
}
export function importShards(s: Store, shared: string) {
	let added = 0;
	const errors: string[] = [];
	for (const name of readdirSync(shared)
		.filter((n) => n.endsWith(".ndjson") && n !== `${s.device.id}.ndjson`)
		.sort()) {
		try {
			const text = readFileSync(join(shared, name), "utf8");
			const lines = text.split("\n");
			if (lines.at(-1) !== "") lines.pop();
			const records = lines.filter(Boolean).map(parse);
			let count = 0;
			s.db.transaction(() => {
				for (const r of records) count += put(s, r.event, r.device, r.seen);
			})();
			added += count;
		} catch (error) {
			errors.push(`${name}: ${String(error)}`);
		}
	}
	return { added, errors };
}
