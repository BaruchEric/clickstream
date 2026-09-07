# Chronicle

Local-first browsing and YouTube activity timeline. TypeScript, Bun, SQLite, FTS5, and plain HTML/JS. No runtime outbound requests, remote assets, telemetry, or account service.

## Run

Install Bun, then run:

```sh
bun install
bun run chronicle init
bun run chronicle ingest
bun run chronicle search "example" --since 7d
bun run chronicle timeline --day today
bun run chronicle stats --since 30d
bun run chronicle devices
bun run chronicle serve
```

Open http://127.0.0.1:4400. `bun run chronicle` is the CLI invocation; no global installation is required. Source and device filters use `--source chrome` and `--device <id>`. `--window 120` controls CLI clustering in seconds. `--day` accepts today, yesterday, or YYYY-MM-DD. Day boundaries and relative day ranges use the machine's local timezone.

Data lives in `~/.chronicle/chronicle.db`; config contains a persistent random device ID. Set `CHRONICLE_HOME` to isolate a database. Change the config's `name` before first ingest to name a device. Device records represent observed activity, so an initialized but empty device is absent from `devices`. `last_seen` is the newest observed activity timestamp, not a connection heartbeat. Do not copy config to another device: initialize each independently.

On POSIX, the directory is 0700 and database/config are 0600. Windows permissions use the platform's inherited ACLs: mode bits do not provide Unix-style access guarantees. Keep the directory restricted to your account. Shards contain sensitive history too; the supplied sync provider controls their replicas and permissions.

## Browser access

Browser sources are opened read-only and snapshotted with SQLite `VACUUM INTO`. Temporary snapshots are removed in a finally block. Live WAL fixture tests cover committed rows while another connection is open. Browsers holding an exclusive lock may still prevent SQLite from reading: fully quit that browser and rerun ingestion. Do not copy live database/WAL files. One failing browser does not stop other profiles.

For Safari on macOS, grant the process launching Chronicle (Terminal or Codex) Full Disk Access in System Settings → Privacy & Security → Full Disk Access, then restart that process and retry. Chronicle does not change system permissions.

Every existing profile under these roots is inspected:

| Browser | macOS | Windows | Linux |
|---|---|---|---|
| Chrome | `~/Library/Application Support/Google/Chrome/*/History` | `%LOCALAPPDATA%/Google/Chrome/User Data/*/History` | `~/.config/google-chrome/*/History` |
| Edge | `~/Library/Application Support/Microsoft Edge/*/History` | `%LOCALAPPDATA%/Microsoft/Edge/User Data/*/History` | `~/.config/microsoft-edge/*/History` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/*/History` | `%LOCALAPPDATA%/BraveSoftware/Brave-Browser/User Data/*/History` | `~/.config/BraveSoftware/Brave-Browser/*/History` |
| Arc | `~/Library/Application Support/Arc/User Data/*/History` | — | — |
| Firefox | `~/Library/Application Support/Firefox/Profiles/*/places.sqlite` | `%APPDATA%/Mozilla/Firefox/Profiles/*/places.sqlite` | `~/.mozilla/firefox/*/places.sqlite` |
| Safari | `~/Library/Safari/History.db` | — | — |

Linux honors XDG_CONFIG_HOME. WSL additionally probes `/mnt/c/Users/*/AppData/Local` and `AppData/Roaming` with the Windows paths above. Custom profile roots outside these locations are not auto-detected. Browser visit IDs are profile-specific watermarks. If you replace/reset a browser profile, use a fresh Chronicle home or clear the corresponding `sync` row before ingesting; immutable stored events still deduplicate.

## Phone and Takeout imports

At https://takeout.google.com, deselect all products, select My Activity and YouTube and YouTube Music, and choose JSON where format selection is available. Include Chrome and Search activity and YouTube history. Create the export, download it yourself, and extract it locally. Export contents depend on account activity settings and retention; missing phone history cannot be reconstructed by Chronicle.

```sh
bun run chronicle ingest --takeout '/path/to/Takeout'
bun run chronicle ingest --takeout '/path/to/watch-history.json'
```

Recognized filenames are `MyActivity.json` and `watch-history.json`, found recursively. HTML exports are unsupported. Repeated/overlapping imports add no duplicate events. Ads are skipped; deleted videos remain with null links. The tool strips the watch prefix and captures available video/channel metadata. Account exports provide the phone data; there is no adb scraper or companion app. iPhone Safari data is available only insofar as iCloud history sync has made it available in the Mac database. Takeout is attributed to the importing device, not an inferred original phone.

## Sharing across your devices

Use a directory already synchronized by Syncthing, iCloud Drive, or your NAS:

```sh
bun run chronicle sync --shared '/path/to/shared/chronicle'
```

Or set `CHRONICLE_SHARED`. `export` and `import` also run independently. Each installation appends to its own `<device-id>.ndjson`; it never writes another device's shard. Sync exports before importing. Imported records remain local and available offline. The original device's shard must reach each peer; relaying imported records through a third device's shard is not implemented. Providers must preserve filenames and file contents. A lock prevents concurrent local exporters; after a crash, remove a stale `.lock` only after confirming no exporter is running. Incomplete imported trailing lines are deferred until a subsequent import. A damaged export tail requires restoring the shard before appending.

Events are immutable, identified by kind + canonical URL + second timestamp. Device attribution is a grow-only join. A separate observation set preserves conflicting payloads sharing an event ID; deterministic read selection prevents first-import-wins output. Do not consume the raw events payload as the authoritative representative: use the cluster read layer. FTS covers all observations.

Clustering is per kind and canonical URL, anchored to the earliest row, with a default 120-second window. Local sources take priority. It can combine genuine repeated visits within that window; use `--window 0` to narrow it. Different redirect URLs are not inferred to be identical. Missing video links use a deterministic title-based surrogate and may conflate unknown videos with identical titles and seconds. `also_seen_in` includes every observed source; device stats count observations and are not proof of which device originated a synced visit.

The UI paginates 50 entries at a time. Reads currently cluster the full observation set in memory; see the benchmark below for tested scale. For phone access, opt in to a reachable binding: `bun run chronicle serve --host 0.0.0.0`. This prints an unauthenticated-access warning. Only use an appropriately restricted private network/VPN.

## Verification and sample preview

```sh
bun run typecheck
bun run lint
bun test
bun scripts/benchmark.ts
bun scripts/demo.ts
CHRONICLE_HOME=data/demo bun run chronicle serve
```

The demo is synthetic, separate from real history, and ignored by Git. See `artifacts/verification.md` for actual results and remaining access blockers. The implementation has been executed on macOS; Windows/WSL/Linux path support is implemented but has not been run on those operating systems.
