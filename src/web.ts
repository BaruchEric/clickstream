import { clusters, type Store, stats } from "./core";
export function serve(s: Store, port = 4400, hostname = "127.0.0.1") {
	if (!["127.0.0.1", "localhost", "::1"].includes(hostname))
		console.warn(
			"Warning: this page has no authentication. Everyone who can reach this address can read your history.",
		);
	const server = Bun.serve({
		port,
		hostname,
		fetch(req) {
			const url = new URL(req.url);
			const headers = {
				"Content-Security-Policy":
					"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			};
			if (url.pathname === "/")
				return new Response(html, {
					headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
				});
			if (url.pathname === "/api/timeline") {
				try {
					const rows = clusters(s, {
						query: url.searchParams.get("q") || undefined,
						source: url.searchParams.get("source") || undefined,
						device: url.searchParams.get("device") || undefined,
					});
					const offset = Math.max(
						0,
						Number(url.searchParams.get("offset")) || 0,
					);
					return Response.json(
						{
							rows: rows.slice(offset, offset + 50),
							total: rows.length,
							stats: stats(rows),
							devices: s.db.query("SELECT * FROM devices ORDER BY id").all(),
						},
						{ headers },
					);
				} catch {
					return Response.json(
						{ error: "Invalid search. Use words or a quoted phrase." },
						{ status: 400, headers },
					);
				}
			}
			return new Response("Not found", { status: 404, headers });
		},
	});
	console.log(`Chronicle: ${server.url}`);
	return server;
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chronicle · Your activity</title><style>
:root{color-scheme:light dark;--bg:#f7f6f2;--fg:#232820;--muted:#70756b;--line:#dddcd4;--card:#fffefa;--accent:#426344}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px system-ui}main{max-width:1120px;margin:auto;padding:44px 28px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:26px}.brand{font:28px Georgia}.privacy{font-size:12px;color:var(--accent)}h1{font:42px Georgia;margin:42px 0 10px}p{color:var(--muted)}form{display:flex;gap:8px;margin:25px 0 14px}input,select,button{font:inherit;border:1px solid var(--line);border-radius:9px;padding:11px;background:var(--card);color:var(--fg)}input{flex:1;min-width:0}button{cursor:pointer}button[type=submit]{background:var(--accent);color:white}.filters{display:flex;gap:8px;flex-wrap:wrap}.layout{display:grid;grid-template-columns:1fr 250px;gap:36px;margin-top:30px}h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-top:26px}.entry{padding:18px 0;border-bottom:1px solid var(--line);display:grid;grid-template-columns:64px 1fr;gap:12px}time{font-size:12px;color:var(--muted)}a{color:var(--fg);text-decoration:none;overflow-wrap:anywhere}a:hover{text-decoration:underline}.detail{font-size:12px;color:var(--muted);margin-top:7px;overflow-wrap:anywhere}.tag{display:inline-block;font-size:11px;background:var(--line);border-radius:4px;padding:3px 6px;margin:6px 5px 0 0}.board{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;align-self:start}.rank{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:10px 0;overflow-wrap:anywhere}#more{margin:24px 0}#status{min-height:20px}@media(max-width:650px){main{padding:24px 18px}h1{font-size:34px}.layout{grid-template-columns:1fr;gap:10px}.board{order:-1}.rank:nth-child(n+5){display:none}.entry{grid-template-columns:48px 1fr}.privacy{max-width:105px;text-align:right}}@media(prefers-color-scheme:dark){:root{--bg:#191e19;--fg:#e4e9df;--muted:#a0aa99;--line:#343d32;--card:#222921;--accent:#668968}}
</style><main><header><div class="brand">◷ Chronicle</div><span class="privacy">LOCAL & PRIVATE</span></header><h1>A little history of your day.</h1><p>Your browsing, watching, and searching — together in one place.</p><form id="search"><input id="q" aria-label="Search activity" placeholder="Search your activity…"><button type="submit">Search</button></form><div class="filters"><select id="source" aria-label="Filter source"><option value="">All sources</option>${["chrome", "edge", "brave", "arc", "firefox", "safari", "google_activity", "youtube"].map((s) => `<option>${s}</option>`).join("")}</select><select id="device" aria-label="Filter device"><option value="">All devices</option></select></div><p id="status" role="status"></p><div class="layout"><section><div id="timeline"></div><button id="more" hidden>Load more</button></section><aside class="board"><h2>Frequent places</h2><div id="domains"></div><h2>Channels</h2><div id="channels"></div></aside></div></main><script>
const el=id=>document.getElementById(id);let offset=0,lastDay='',generation=0;function node(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n}async function load(reset=true){const current=++generation;if(reset){offset=0;lastDay='';el('timeline').replaceChildren()}el('status').textContent='Loading activity…';try{const p=new URLSearchParams({q:el('q').value,source:el('source').value,device:el('device').value,offset:String(offset)});const response=await fetch('/api/timeline?'+p);const data=await response.json();if(current!==generation)return;if(data.error)throw Error(data.error);el('status').textContent=data.total.toLocaleString()+' activities';if(el('device').options.length===1)for(const d of data.devices){const o=node('option',d.name+' · '+d.id.slice(0,8));o.value=d.id;el('device').append(o)}for(const r of data.rows){const date=new Date(r.ts),day=date.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});if(day!==lastDay){el('timeline').append(node('h2',day));lastDay=day}const article=node('article',null,'entry');article.append(node('time',date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));const body=node('div');const link=node('a',r.title||r.url||'Unavailable video');if(r.url&&/^https?:/i.test(r.url)){link.href=r.url;link.target='_blank';link.rel='noopener noreferrer'}body.append(link,node('div',r.domain||'Unavailable link','detail'));for(const source of r.also_seen_in)body.append(node('span',source,'tag'));body.append(node('div','Observed on '+r.devices.map(id=>data.devices.find(d=>d.id===id)?.name||id.slice(0,8)).join(', '),'detail'));article.append(body);el('timeline').append(article)}offset+=data.rows.length;el('more').hidden=offset>=data.total;if(!data.total)el('timeline').append(node('p','No activity yet. Ingest browser history or import a Takeout export.'));for(const key of ['domains','channels']){el(key).replaceChildren();for(const [name,count]of data.stats[key].slice(0,8)){const row=node('div',null,'rank');row.append(node('span',name),node('strong',String(count)));el(key).append(row)}if(!data.stats[key].length)el(key).append(node('p','No activity'))}}catch(e){el('status').textContent=e.message}}el('search').onsubmit=e=>{e.preventDefault();load()};el('source').onchange=()=>load();el('device').onchange=()=>load();el('more').onclick=()=>load(false);load();</script></html>`;
