const el = (id) => document.getElementById(id);
const filters = [
	"view",
	"noise",
	"period",
	"kind",
	"source",
	"device",
	"domain",
	"tag",
];
let offset = 0,
	lastDay = "",
	generation = 0,
	loading = false;
function node(tag, text, cls) {
	const n = document.createElement(tag);
	if (text) n.textContent = text;
	if (cls) n.className = cls;
	return n;
}
function params() {
	return new URLSearchParams(
		Object.fromEntries(["q", ...filters].map((k) => [k, el(k).value])),
	);
}
async function post(path, data) {
	const res = await fetch(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	const result = await res.json();
	if (!res.ok) throw Error(result.error || "Could not save");
	return result;
}
function button(text, action) {
	const b = node("button", text);
	b.type = "button";
	b.onclick = action;
	return b;
}
function edit(body, r) {
	if (body.querySelector(".editor")) return;
	const form = node("form", null, "editor");
	function field(label, value, tag = "textarea") {
		const l = node("label", label);
		const input = node(tag);
		input.setAttribute("aria-label", label);
		input.value = value || "";
		l.append(input);
		form.append(l);
		return input;
	}
	const title = field("Title", r.note?.title || r.title || "Untitled", "input");
	title.maxLength = 1000;
	const note = field("Notes — what is useful here?", r.note?.body);
	note.maxLength = 50000;
	const next = field(
		"Next step — what do you want to explore?",
		r.note?.next_step,
	);
	next.maxLength = 10000;
	const tags = field(
		"Your tags (comma separated)",
		r.custom_tags.join(", "),
		"input",
	);
	const excluded = field(
		"Hide automatic tags (comma separated)",
		r.excluded_tags.join(", "),
		"input",
	);
	form.append(
		node(
			"p",
			`Suggested automatically: ${r.auto_tags.join(", ") || "None yet"}`,
			"notice",
		),
	);
	const state = field("Status", "", "select");
	for (const [value, label] of [
		["saved", "Saved"],
		["explore", "Explore further"],
		["done", "Done"],
	]) {
		const option = node("option", label);
		option.value = value;
		state.append(option);
	}
	state.value = r.note?.status || "saved";
	const actions = node("div", null, "actions"),
		save = node("button", "Save note");
	save.type = "submit";
	const message = node("span");
	message.setAttribute("role", "status");
	actions.append(
		save,
		button("Cancel", () => form.remove()),
	);
	form.append(actions, message);
	form.onsubmit = async (e) => {
		e.preventDefault();
		save.disabled = true;
		try {
			await post("/api/notes", {
				canonical_url: r.canonical_url,
				title: title.value,
				body: note.value,
				next_step: next.value,
				status: state.value,
				tags: tags.value
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
				excluded_tags: excluded.value
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
			});
			for (const key of ["q", ...filters])
				el(key).value = key === "view" ? "saved" : key === "noise" ? "on" : "";
			await load();
			const saved = [...document.querySelectorAll("article")].find(
				(article) => article.dataset.url === r.canonical_url,
			);
			if (saved) {
				saved.classList.add("just-saved");
				saved.tabIndex = -1;
				saved.focus({ preventScroll: true });
				saved.scrollIntoView({ block: "center", behavior: "smooth" });
				el("status").textContent =
					`Saved to your logs. ${el("status").textContent}`;
			}
		} catch (error) {
			message.textContent = error.message;
			save.disabled = false;
		}
	};
	body.append(form);
	note.focus();
}
async function load(reset = true) {
	if (!reset && loading) return;
	const current = ++generation;
	loading = true;
	el("more").disabled = true;
	if (reset) {
		offset = 0;
		lastDay = "";
		el("timeline").replaceChildren();
	}
	el("status").textContent = "Loading…";
	try {
		const p = params();
		p.set("offset", String(offset));
		const response = await fetch(`/api/timeline?${p}`);
		const data = await response.json();
		if (current !== generation) return;
		if (data.error) throw Error(data.error);
		el("status").textContent =
			data.total.toLocaleString() +
			" items · " +
			data.hidden.toLocaleString() +
			" noise entries hidden";
		el("tag-topics").replaceChildren();
		el("tag-options").replaceChildren();
		for (const [tag, count] of data.tag_counts) {
			const chip = button(`#${tag} · ${count.toLocaleString()}`, () => {
				el("tag").value = el("tag").value === tag ? "" : tag;
				load();
			});
			chip.className = "topic";
			chip.setAttribute("aria-pressed", String(el("tag").value === tag));
			el("tag-topics").append(chip);
			const option = node("option");
			option.value = tag;
			el("tag-options").append(option);
		}
		if (!data.tag_counts.length)
			el("tag-topics").append(
				node(
					"p",
					"No topics detected for these filters. Try a wider range or add your own tags.",
				),
			);
		if (el("device").options.length === 1)
			for (const d of data.devices) {
				const o = node("option", `${d.name} · ${d.id.slice(0, 8)}`);
				o.value = d.id;
				el("device").append(o);
			}
		for (const r of data.rows) {
			const date = new Date(r.ts),
				day = date.toLocaleDateString(undefined, {
					weekday: "long",
					month: "long",
					day: "numeric",
					year: "numeric",
				});
			if (day !== lastDay) {
				el("timeline").append(node("h2", day));
				lastDay = day;
			}
			const article = node("article", null, "entry");
			article.dataset.url = r.canonical_url;
			article.append(
				node(
					"time",
					date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				),
			);
			const body = node("div"),
				link = node(
					"a",
					r.note?.title || r.title || r.url || "Unavailable video",
				);
			if (r.url && /^https?:/i.test(r.url)) {
				link.href = r.url;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
			}
			body.append(link, node("div", r.domain || "Unavailable link", "detail"));
			for (const source of r.also_seen_in)
				body.append(node("span", source, "tag"));
			for (const tag of r.tags) {
				const chip = button(`#${tag}`, () => {
					el("tag").value = tag;
					load();
				});
				chip.className = "tag topic";
				chip.title = r.custom_tags.includes(tag)
					? "Your tag"
					: "Suggested from title, URL, or notes";
				body.append(chip);
			}
			if (r.noise_reason) body.append(node("span", r.noise_reason, "tag"));
			if (r.note) {
				body.append(node("span", r.note.status, "tag"));
				if (r.note.body) body.append(node("div", r.note.body, "note-preview"));
				if (r.note.next_step)
					body.append(node("div", `Next: ${r.note.next_step}`, "note-preview"));
			}
			const actions = node("div", null, "actions");
			actions.append(
				button(r.note ? "Edit note" : "Save / add note", () => edit(body, r)),
			);
			if (r.domain)
				actions.append(
					button(
						data.muted.includes(r.domain) ? "Unmute domain" : "Mute domain",
						async () => {
							try {
								await post("/api/mute", {
									domain: r.domain,
									muted: !data.muted.includes(r.domain),
								});
								load();
							} catch (e) {
								el("status").textContent = e.message;
							}
						},
					),
				);
			body.append(actions);
			article.append(body);
			el("timeline").append(article);
		}
		offset += data.rows.length;
		el("more").hidden = offset >= data.total;
		if (!data.total)
			el("timeline").append(
				node(
					"p",
					"No matching items. Try Show all, a wider date range, or save an activity to start your notes.",
				),
			);
		for (const key of ["domains", "channels"]) {
			el(key).replaceChildren();
			for (const [name, count] of data.stats[key].slice(0, 8)) {
				const row = node("div", null, "rank");
				row.append(node("span", name), node("strong", String(count)));
				el(key).append(row);
			}
			if (!data.stats[key].length) el(key).append(node("p", "No activity"));
		}
		el("muted").replaceChildren();
		for (const domain of data.muted)
			el("muted").append(
				button(`Unmute ${domain}`, async () => {
					try {
						await post("/api/mute", { domain, muted: false });
						load();
					} catch (e) {
						el("status").textContent = e.message;
					}
				}),
			);
		if (!data.muted.length) el("muted").append(node("p", "No muted domains"));
	} catch (e) {
		if (current === generation) el("status").textContent = e.message;
	} finally {
		if (current === generation) {
			loading = false;
			el("more").disabled = false;
		}
	}
}
el("search").onsubmit = (e) => {
	e.preventDefault();
	load();
};
for (const key of filters) el(key).onchange = () => load();
el("more").onclick = () => load(false);
el("reset").onclick = () => {
	for (const key of ["q", ...filters])
		el(key).value = key === "view" ? "activity" : key === "noise" ? "on" : "";
	load();
};
el("export").onclick = () => {
	window.location.href = `/api/export?${params()}`;
};
load();
