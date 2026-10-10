# clickstream

<!-- spec:begin v1.0.0 -->
How to keep this file (shared repo spec 1.0.0):
- SPEC.md says what this repo is, how it is built and why. It is the first file a person or an agent reads.
- Keep the seven sections below, in this order, under the same headings. Write "none" rather than drop one.
- Sections 1, 3 and 4 are required: what it is, the stack with versions, and the exact commands to build, test and run.
- Stay under 120 lines. Link to longer docs rather than copying them here.
- Decisions are dated one-liners with their why: "2026-10-04: Bun over Node, because the CLI starts faster."
- Update SPEC.md in the same commit as the change that makes it wrong.
- Out of scope lists what this repo will not do, so an agent does not add it.
- Commands are written as they are typed, one per line, from the repo root.
- Name versions as the lockfile has them, not "latest".
- No secrets, tokens or hostnames that are private.
<!-- spec:end -->

## What it is

Chronicle: a local-first timeline of your own browsing and YouTube activity, searchable from a CLI and a local web UI.
It reads browser history databases, Google Takeout exports and a Chrome capture extension into one SQLite file.
The repo directory is clickstream; the package and CLI are named chronicle.

## Who uses it

One person, on each of their own machines (macOS tested; Windows, WSL and Linux paths implemented but not run).
Devices share history through a folder synced by Syncthing, iCloud Drive or a NAS. Phone access is opt-in over a private network.

## Stack and versions

- Runtime: Bun (bun-types 1.4.1 in bun.lock), ESM, `bun:sqlite` with FTS5. No runtime npm dependencies.
- TypeScript 7.0.2, strict, `tsc --noEmit` only (no emitted build).
- Biome 2.5.12 for lint and format.
- Web UI: plain HTML, JS and CSS in `src/` (index.html, client.js, style.css), served by `src/web.ts`.
- Chrome extension: Manifest V3, version 0.1.0, plain JS in `extension/`.
- package.json asks for "latest" on all dev dependencies; bun.lock holds the versions above.

## How it is built and run

There is no build step. Bun runs the TypeScript directly.

```sh
bun install
bun run chronicle init
bun run chronicle ingest
bun run chronicle ingest --takeout /path/to/Takeout
bun run chronicle sync --shared /path/to/shared/chronicle
bun run chronicle serve
bun run typecheck
bun run lint
bun test
bun scripts/benchmark.ts
bun scripts/demo.ts
CHRONICLE_HOME=data/demo bun run chronicle serve
```

`serve` listens on http://127.0.0.1:4400 by default (`--port` changes it); the extension only works on 4400. `--host 0.0.0.0` exposes it without auth.
Full CLI flags are in README.md. Extension install and pairing are in extension/README.md.

## Data and state

- `~/.chronicle/chronicle.db` (SQLite) plus a config file with a random device ID; `CHRONICLE_HOME` overrides the directory. Directory 0700, files 0600 on POSIX.
- `~/.chronicle/extension-token`: the pairing token for the Chrome extension.
- Events are immutable, keyed by kind, canonical URL and second timestamp. Notes, tags and muted domains are local only.
- Sync: each device appends only to its own `<device-id>.ndjson` shard in the shared folder.
- Browser databases are opened read-only and copied with `VACUUM INTO` to a temporary snapshot that is deleted afterwards.
- `data/` (demo and scratch homes), `*.db` and `*.ndjson` are gitignored.

## Decisions

- 2026-09-07: Snapshot browser history with `VACUUM INTO` instead of copying files, because live database and WAL copies are unsafe.
- 2026-09-07: One append-only NDJSON shard per device, so no installation ever writes another device's file.
- 2026-09-07: Noise filtering and smart tags are plain keyword rules, not AI relevance judgments, so every hidden entry shows its reason.
- 2026-10-09: Agent digests go through the local Codex CLI, so the extension embeds no model API key.

## Out of scope

- Any automatic outbound request, remote asset, telemetry or account service.
- Fetching page contents, scraping phones over adb, or a companion phone app.
- Takeout HTML exports, and relaying another device's records through a third device's shard.
- Changing system permissions (Safari Full Disk Access is granted by the user).
