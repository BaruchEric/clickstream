# Verification — 2026-09-07

Fixture and UI checks pass. Live Chrome ingestion and a zero-row repeat have also been verified. Safari access remains blocked by macOS permissions.

## Actual command output

```text
$ bun run typecheck
$ tsc --noEmit

$ bun run lint
$ biome check src tests
Checked 6 files in 5ms. No fixes applied.

$ bun test
13 pass
0 fail
46 expect() calls
Ran 13 tests across 1 file. [150.00ms]

$ bun scripts/benchmark.ts
{"stored":100001,"clusters":100001,"read_ms":383,"page_size":50}

$ CHRONICLE_HOME=data/demo bun run chronicle sync --shared data/scratch-shared
{"file":"data/scratch-shared/9170b420-504c-48dc-9b95-f57b7189b9cd.ndjson","exported":65}
{"added":0,"errors":[]}

$ CHRONICLE_HOME=data/roundtrip bun run chronicle import --shared data/scratch-shared
{"added":65,"errors":[]}

Row-count and search readback:
{"original":{"n":65},"roundtrip":{"n":65},"search_sources":["chrome","youtube"]}
```

The tests cover all six browser sources using live SQLite WAL fixtures, epoch conversion for each engine, Takeout ad/deleted-video cases and overlap, 40-second cross-source clustering with Chrome timestamp priority, same-ID synced visits and device union, reverse import order including conflicting payloads, greedy window anchoring, profile discovery, and local-midnight boundaries.

## Browser verification through Computer

- Desktop screenshot: `desktop.png`.
- Mobile screenshot: `mobile.png`, 390 × 844 viewport.
- Initial page: 65 activities with 50 articles rendered.
- Load more: 65 articles, button hidden.
- Search `attention`: 13 activities.
- Firefox filter: 13 activities; Chrome filter: 26 activities.
- Mobile document client width and scroll width both 375px inside the 390px viewport: no horizontal overflow.
- Screenshots use synthetic data from `data/demo`, not personal browsing history.

## Live browser verification

Chrome ingestion succeeded after quitting Chrome to release its history database lock. A subsequent ingestion read zero new rows and added zero events. The local UI API successfully served the imported timeline. Personal history and its counts are intentionally omitted from this public report.

Safari returned `SQLiteError: authorization denied`. Safari requires Full Disk Access for the calling process, followed by restarting that process. No Takeout export was supplied; its tests are fixture-based.

Windows, Linux, and WSL execution has not been verified on actual devices.
