import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { event, open, put } from "../src/core";
import { curated, markdown, saveNote, setup } from "../src/curation";
import { normalizeTags, smartTags } from "../src/tags";

test("smart tags use word boundaries and ignore query strings", () => {
	expect(
		smartTags({
			title: "A guide to TypeScript",
			canonical_url: "https://example.com/",
			kind: "page_view",
		}),
	).toEqual(["learning", "programming"]);
	expect(
		smartTags({
			title: "Chair repair",
			canonical_url: "https://example.com/?q=ai",
			kind: "page_view",
		}),
	).toEqual([]);
	expect(normalizeTags(["#Ideas", "ideas", " Work "])).toEqual([
		"ideas",
		"work",
	]);
	expect(() => normalizeTags([123])).toThrow();
});
test("custom tags and exclusions persist, filter, search and export", () => {
	const home = mkdtempSync(join(tmpdir(), "chronicle-tags-"));
	let s = open(home);
	try {
		setup(s);
		const e = event({
			source: "chrome",
			kind: "page_view",
			ts: 1000,
			title: "Python tutorial",
			url: "https://example.com/",
			duration_ms: null,
			meta: "{}",
		});
		put(s, e, s.device);
		saveNote(s, {
			canonical_url: e.canonical_url,
			title: e.title,
			body: "",
			next_step: "",
			status: "saved",
			tags: ["Project A"],
			excluded_tags: ["learning"],
		});
		s.db.close();
		s = open(home);
		const result = curated(s, new URLSearchParams("tag=Project A"));
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].tags).toEqual(["programming", "project a"]);
		expect(curated(s, new URLSearchParams("tag=learning")).rows).toHaveLength(
			0,
		);
		expect(curated(s, new URLSearchParams("q=project a")).rows).toHaveLength(1);
		expect(markdown(result.rows)).toContain("#project a");
	} finally {
		s.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
