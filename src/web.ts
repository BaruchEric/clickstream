import { join } from "node:path";
import { type Store, stats } from "./core";
import { curated, markdown, saveNote, setup } from "./curation";
export function serve(s: Store, port = 4400, hostname = "127.0.0.1") {
	setup(s);
	if (!["127.0.0.1", "localhost", "::1"].includes(hostname))
		console.warn(
			"Warning: this page has no authentication. Everyone who can reach this address can read your history.",
		);
	const server = Bun.serve({
		port,
		hostname,
		async fetch(req) {
			const url = new URL(req.url);
			const headers = {
				"Content-Security-Policy":
					"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			};
			try {
				if (req.method === "POST") {
					if (
						req.headers.get("origin") !== url.origin ||
						req.headers.get("content-type") !== "application/json"
					)
						return new Response("Same-origin JSON required", {
							status: 403,
							headers,
						});
					const text = await req.text();
					if (text.length > 70000)
						return new Response("Request too large", { status: 413, headers });
					const input = JSON.parse(text);
					if (url.pathname === "/api/notes") {
						saveNote(s, input);
						return Response.json({ ok: true }, { headers });
					}
					if (url.pathname === "/api/mute") {
						if (
							typeof input.domain !== "string" ||
							input.domain.length > 253 ||
							!/^[a-z0-9.:[\]-]+$/i.test(input.domain) ||
							typeof input.muted !== "boolean"
						)
							throw Error("Invalid domain");
						s.db
							.query(
								input.muted
									? "INSERT OR IGNORE INTO muted_domains VALUES(?)"
									: "DELETE FROM muted_domains WHERE domain=?",
							)
							.run(input.domain);
						return Response.json({ ok: true }, { headers });
					}
					return new Response("Not found", { status: 404, headers });
				}
				if (req.method !== "GET")
					return new Response("Method not allowed", { status: 405, headers });
				const assets: Record<string, string> = {
					"/": "index.html",
					"/client.js": "client.js",
					"/style.css": "style.css",
				};
				if (assets[url.pathname])
					return new Response(
						Bun.file(join(import.meta.dir, assets[url.pathname])),
						{ headers },
					);
				if (
					url.pathname === "/api/timeline" ||
					url.pathname === "/api/export"
				) {
					const data = curated(s, url.searchParams);
					if (url.pathname === "/api/export")
						return new Response(markdown(data.rows), {
							headers: {
								...headers,
								"Content-Type": "text/markdown; charset=utf-8",
								"Content-Disposition":
									'attachment; filename="chronicle-log.md"',
							},
						});
					const offset = Math.max(
						0,
						Math.floor(Number(url.searchParams.get("offset")) || 0),
					);
					return Response.json(
						{
							...data,
							rows: data.rows.slice(offset, offset + 50),
							total: data.rows.length,
							stats: stats(data.rows),
							devices: s.db.query("SELECT * FROM devices ORDER BY id").all(),
						},
						{ headers },
					);
				}
				return new Response("Not found", { status: 404, headers });
			} catch (error) {
				return Response.json(
					{ error: error instanceof Error ? error.message : "Request failed" },
					{ status: 400, headers },
				);
			}
		},
	});
	console.log(`Chronicle: ${server.url}`);
	return server;
}
