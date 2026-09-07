import { parseArgs } from "node:util";
import { clusters, day, open, since, stats } from "./core";
import { detect, ingestBrowser, ingestTakeout } from "./ingest";
import { exportShard, importShards } from "./sync";
import { serve } from "./web";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: Object.fromEntries(
		[
			"source",
			"takeout",
			"shared",
			"since",
			"device",
			"day",
			"port",
			"host",
			"window",
		].map((k) => [k, { type: "string" as const }]),
	),
});
const s = open();
const output = (v: unknown) => console.log(JSON.stringify(v, null, 2));
try {
	const command = positionals[0] || "help";
	const f = {
		source: values.source,
		device: values.device,
		since: values.since ? since(values.since) : undefined,
		window: values.window ? Number(values.window) : 120,
	};
	if (!Number.isFinite(f.window) || f.window < 0)
		throw Error("Invalid clustering window");
	switch (command) {
		case "init":
			output({ home: s.home, device: s.device });
			break;
		case "ingest":
			for (const p of detect().filter(
				(p) => !values.source || p.source === values.source,
			)) {
				try {
					output(ingestBrowser(s, p));
				} catch (e) {
					console.error(
						`${p.source}: ${String(e)}. Check browser profile permissions; Safari on macOS requires Full Disk Access for the calling terminal or Codex in System Settings > Privacy & Security.`,
					);
				}
			}
			if (values.takeout)
				output(ingestTakeout(s, values.takeout, values.source));
			break;
		case "export":
		case "import":
		case "sync": {
			const shared = values.shared || process.env.CHRONICLE_SHARED;
			if (!shared)
				throw Error("Supply --shared <directory> or CHRONICLE_SHARED");
			if (command !== "import") output(exportShard(s, shared));
			if (command !== "export") output(importShards(s, shared));
			break;
		}
		case "search":
			output(clusters(s, { ...f, query: positionals.slice(1).join(" ") }));
			break;
		case "timeline":
			output(clusters(s, { ...f, ...(values.day ? day(values.day) : {}) }));
			break;
		case "stats":
			output(stats(clusters(s, { ...f, since: f.since ?? since("30d") })));
			break;
		case "devices":
			output(s.db.query("SELECT * FROM devices ORDER BY id").all());
			break;
		case "serve":
			serve(s, Number(values.port || 4400), values.host || "127.0.0.1");
			break;
		default:
			console.log(
				"chronicle init | ingest [--source NAME] [--takeout PATH] | export/import/sync --shared DIR | search QUERY | timeline [--day today] | stats | devices | serve [--port 4400]",
			);
	}
} catch (e) {
	console.error(String(e));
	process.exitCode = 1;
} finally {
	if (positionals[0] !== "serve") s.db.close();
}
