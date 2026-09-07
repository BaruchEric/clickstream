import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { event, open, put } from "../src/core";
import { curated, markdown, saveNote, setup } from "../src/curation";
import { serve } from "../src/web";

test("noise is reversible, notes survive repeats and search/export include notes", () => {
	const home = mkdtempSync(join(tmpdir(), "chronicle-curation-"));
	const s = open(home);
	try {
		setup(s);
		for (const [url, time] of [
			["https://example.com/article", 1000000],
			["https://example.com/article", 2000000],
			["https://example.com/login", 3000000],
			["http://localhost:4400/", 4000000],
		] as const)
			put(
				s,
				event({
					source: "chrome",
					kind: "page_view",
					ts: time,
					title: "Fixture",
					url,
					duration_ms: null,
					meta: "{}",
				}),
				s.device,
			);
		expect(curated(s, new URLSearchParams()).rows).toHaveLength(1);
		expect(curated(s, new URLSearchParams("noise=off")).rows).toHaveLength(4);
		saveNote(s, {
			canonical_url: "https://example.com/article",
			title: "Useful idea",
			body: "Research orbital systems",
			next_step: "Build prototype",
			status: "explore",
		});
		s.db.query("INSERT INTO muted_domains VALUES(?)").run("example.com");
		const saved = curated(s, new URLSearchParams("view=explore&q=orbital"));
		expect(saved.rows).toHaveLength(1);
		expect(markdown(saved.rows)).toContain("Build prototype");
		expect(
			curated(s, new URLSearchParams("view=saved&domain=other.com")).rows,
		).toHaveLength(0);
		expect(
			(s.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n,
		).toBe(4);
	} finally {
		s.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
test("note API rejects cross-origin writes and persists valid notes", async () => {
	const home = mkdtempSync(join(tmpdir(), "chronicle-api-"));
	const s = open(home);
	put(
		s,
		event({
			source: "chrome",
			kind: "page_view",
			ts: 1000,
			title: "Fixture",
			url: "https://example.com/",
			duration_ms: null,
			meta: "{}",
		}),
		s.device,
	);
	const server = serve(s, 0);
	try {
		const body = JSON.stringify({
			canonical_url: "https://example.com/",
			title: "Note",
			body: "Remember",
			next_step: "Read more",
			status: "saved",
		});
		const denied = await fetch(new URL("/api/notes", server.url), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "https://example.org",
			},
			body,
		});
		expect(denied.status).toBe(403);
		const ok = await fetch(new URL("/api/notes", server.url), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: server.url.origin,
			},
			body,
		});
		expect(ok.status).toBe(200);
		const saved = await (
			await fetch(new URL("/api/timeline?view=saved", server.url))
		).json();
		expect(saved.rows[0].note.body).toBe("Remember");
	} finally {
		server.stop(true);
		s.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
