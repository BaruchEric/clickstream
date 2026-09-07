import type { Cluster } from "./core";

const rules: [string, RegExp][] = [
	[
		"programming",
		/\b(code|coding|programming|typescript|javascript|python|rust|react|sqlite|api|github|debugging)\b/i,
	],
	[
		"ai",
		/\b(ai|llm|chatgpt|openai|machine learning|artificial intelligence|neural network)\b/i,
	],
	["design", /\b(design|figma|typography|ux|ui|wireframe|prototype)\b/i],
	["research", /\b(research|paper|study|arxiv|experiment|findings)\b/i],
	[
		"learning",
		/\b(tutorial|guide|course|learn|learning|how to|documentation|docs)\b/i,
	],
	[
		"productivity",
		/\b(productivity|workflow|notes|note taking|reflection|weekly review|organize|planning)\b/i,
	],
	["tools", /\b(tool|tools|software|plugin|extension|app)\b/i],
	["reading", /\b(article|blog|essay|newsletter)\b/i],
];
export function smartTags(
	row: Pick<Cluster, "title" | "canonical_url" | "kind">,
	note?: { title: string; body: string; next_step: string } | null,
) {
	let path = "";
	let host = "";
	try {
		const u = new URL(row.canonical_url);
		path = decodeURIComponent(u.pathname).replace(/[-_/]/g, " ");
		host = u.hostname;
	} catch {}
	const text = [row.title, path, note?.title, note?.body, note?.next_step]
		.filter(Boolean)
		.join(" ");
	const tags = rules
		.filter(([, pattern]) => pattern.test(text))
		.map(([tag]) => tag);
	if (host === "github.com" || host === "stackoverflow.com")
		tags.push("programming");
	if (
		row.kind === "video_watch" ||
		/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host)
	)
		tags.push("video");
	if (row.kind === "search") tags.push("search");
	return [...new Set(tags)].sort();
}
export function normalizeTags(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length > 30 ||
		value.some((v) => typeof v !== "string" || v.length > 40)
	)
		throw Error("Use up to 30 tags of at most 40 characters");
	return [
		...new Set(
			value
				.map((v) => v.trim().toLowerCase().replace(/^#+/, ""))
				.filter(Boolean),
		),
	].sort();
}
