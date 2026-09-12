# Production lifecycle verification — 2026-09-12

The aerie installation now serves a pinned immutable build, and its 03:00 calendar job invokes the
HTTP-only scheduled entry point. The database and deliberately disabled production auth were
preserved. No default tmux operations were performed.

## Incident evidence

- `~/Library/Logs/Ongoing/stderr.log` contains missing adapter-node lazy chunk failures for `/`,
  `/api/projects`, `/api/entries`, and `/api/providers` after prior builds.
- The installed calendar ran `scripts/scan.ts`, which imported the source standalone scanner.
  `CatalogDatabase` applies migrations on open. Catalog migration records show versions 7 and 8 at
  `2026-09-12T10:00:05.881Z` and `10:00:06.034Z` (03:00 local); the scheduled scan started at
  `10:00:06.057Z`. This supports the reported source/deployed-schema mismatch. Retained logs do
  not contain a corresponding missing-table stack trace.

## Production transition and proof

A consistent SQLite backup was saved as
`~/Library/Application Support/Ongoing/ongoing.sqlite.backups/lifecycle-20260912-085755.sqlite`.
The service was stopped and its unloaded launchd state verified before adopting the old `build/`
directory under `.ongoing-builds/` and restarting the updated launcher.

Two ordinary `bun run build` invocations ran while production served requests. The first monitored
40 requests and the second 16 requests, including `/`, `/radar`, `/providers`, `/api/entries`,
`/api/projects`, and three CSS assets referenced by the existing page. Every request returned 200;
old handlers remained present. The second build ran while the scheduled scan was active. The browser
also rendered the live inventory with 162 entries. Build output changed the selected symlink without
changing the directory pinned by the running process.

The scan plist retains 03:00 and has no RunAtLoad/KeepAlive. It now supplies `ONGOING_URL` and no
DATABASE_PATH or SCAN_ROOTS. Triggering the installed job spawned the CLI with
`scan --transport http --wait --json`, and the web process acquired the lease. Its exact run is
`scan_a5ccfb4a-0e35-49c6-8c4f-71fe630b2386`. It completed at `2026-09-12T16:05:39.564Z`
with 132 discovered, 132 updated, and zero errors; launchd recorded exit code 0. The schema
remained at version 9 and the catalog retained 162 entries.

## Automated and independent checks

- `bun run lint`: passed.
- `bun run test`: 411 tests passed in 42 files.
- `bun run check`: passed; no Svelte errors or warnings.
- `bun run deploy/aerie/production-smoke.ts`: authentication, bounded login/mutations,
  fixed-length/chunked body limits, and logout passed against a temporary catalog.
- Regression tests cover retained old lazy chunks, failed/incomplete publication, concurrent-build
  refusal, legacy-directory refusal, HTTP transport enforcement despite a local environment,
  unavailable-service behavior without creating a database, and exact-run failure exit status.
- Independent lifecycle review found three issues (legacy adoption, argument bypass, latest-run
  ambiguity); all were repaired, regression-tested, and re-reviewed with no remaining findings.
- Fractal validates: 86 elements, 134 relationships, 12 scenes, 5 journeys. Affected operation,
  trust-boundary, daily-refresh, and manual-scan exports were regenerated; operations and daily
  sequence renders were visually inspected.

## Operating limits

A build publishes artifacts; restart activates them. Old immutable builds are intentionally retained
until maintenance can establish that no process uses them. An interrupted builder can leave a lock
requiring operator inspection. Legacy directory installs refuse their first upgraded build until
adopted while stopped. A scheduled scan fails without source fallback when its service is unavailable.
