import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusters, open } from "../src/core";
import {
	authorized,
	capturePage,
	extensionToken,
	recordVisit,
	setupCaptures,
} from "../src/extension";
import { serve } from "../src/web";

test("extension pairing, visits and capture retries", () => {
	const home = mkdtempSync(join(tmpdir(), "capture-test-"));
	const s = open(home);
	try {
		expect(authorized(s, "Bearer wrong")).toBe(false);
		expect(authorized(s, `Bearer ${extensionToken(s)}`)).toBe(true);
		const visit = { title: "Example", url: "https://example.com/", ts: 1000 };
		expect(recordVisit(s, visit).added).toBe(1);
		expect(recordVisit(s, visit).added).toBe(0);
		const capture = {
			id: randomUUID(),
			title: "Example",
			url: "https://example.com/",
			ts: 2000,
			content: "Example page text",
			digest: false,
		};
		capturePage(s, capture);
		capturePage(s, capture);
		expect(clusters(s)).toHaveLength(2);
		expect(
			(s.db.query("SELECT COUNT(*) n FROM captures").get() as { n: number }).n,
		).toBe(1);
		expect(() =>
			capturePage(s, { ...capture, id: randomUUID(), content: "" }),
		).toThrow();
	} finally {
		s.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
test("extension endpoint rejects missing token and accepts paired origin", async () => {
	const home = mkdtempSync(join(tmpdir(), "capture-api-"));
	const s = open(home);
	setupCaptures(s);
	const server = serve(s, 0);
	try {
		const endpoint = new URL("/api/extension", server.url);
		const body = JSON.stringify({
			type: "visit",
			title: "Test",
			url: "https://example.com/",
			ts: 1000,
		});
		expect((await fetch(endpoint, { method: "POST", body })).status).toBe(401);
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${extensionToken(s)}`,
				Origin: `chrome-extension://${"a".repeat(32)}`,
				"Content-Type": "application/json",
			},
			body,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			`chrome-extension://${"a".repeat(32)}`,
		);
		expect(
			(
				await fetch(new URL("/api/pair-token", server.url), {
					method: "POST",
					headers: { Origin: "https://evil.example" },
				})
			).status,
		).toBe(403);
	} finally {
		server.stop(true);
		s.db.close();
		rmSync(home, { recursive: true, force: true });
	}
});
