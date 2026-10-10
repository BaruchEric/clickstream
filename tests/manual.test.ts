import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusters, open } from "../src/core";
import { curated } from "../src/curation";
import { createManualEvent } from "../src/manual";
import { exportShard, importShards } from "../src/sync";

test("manual events are distinct, retry-safe, saved and syncable", () => {
	const home = mkdtempSync(join(tmpdir(), "manual-test-"));
	const s = open(join(home, "a")),
		peer = open(join(home, "b"));
	try {
		const input = {
			id: randomUUID(),
			title: "Research idea",
			ts: 1000,
			body: "Explore this",
			tags: ["Idea"],
		};
		createManualEvent(s, input);
		createManualEvent(s, input);
		createManualEvent(s, { ...input, id: randomUUID() });
		expect(clusters(s)).toHaveLength(2);
		const saved = curated(s, new URLSearchParams("view=saved&source=manual"));
		expect(saved.rows).toHaveLength(2);
		expect(saved.rows[0].note?.body).toBe("Explore this");
		expect(saved.rows[0].url).toBeNull();
		exportShard(s, join(home, "shared"));
		importShards(peer, join(home, "shared"));
		expect(clusters(peer)).toHaveLength(2);
		expect(() =>
			createManualEvent(s, {
				...input,
				id: randomUUID(),
				url: "javascript:alert(1)",
			}),
		).toThrow();
		expect(() =>
			createManualEvent(s, { ...input, id: randomUUID(), tags: [123] }),
		).toThrow();
		expect(clusters(s)).toHaveLength(2);
	} finally {
		s.db.close();
		peer.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
