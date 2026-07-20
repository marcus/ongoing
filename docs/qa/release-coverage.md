# First-release coverage map

This map ties the first-release definition of done and test strategy in
`docs/plans/ongoing-projects-dashboard.md` to executable checks. It is intentionally pragmatic for
a single-user, trusted-LAN application: related stories share feature-level release gates, while
security, persistence, migration, and deployment boundaries keep dedicated coverage.

## Unit and domain coverage

| Plan requirement                                                                                 | Automated evidence                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Every sort, both directions, null-last behavior, and name tie-breaking                           | `src/lib/domain/sorting.test.ts`; every URL sort is also exercised in `tests/e2e/home.test.ts`                            |
| Manual reorder validation, transactional rank assignment, and hidden-rank preservation           | `tests/integration/catalog.test.ts`; pointer and keyboard flows in `tests/e2e/home.test.ts`                               |
| Favorite, note, hide, restore, and decision-field transitions                                    | `src/lib/server/projects/actions.test.ts`, `tests/integration/catalog.test.ts`, and `tests/e2e/home.test.ts`              |
| GitHub SSH/HTTPS remote parsing and malformed/non-GitHub rejection                               | `src/lib/server/collectors/github.test.ts`                                                                                |
| Git, cloc, TD, and GitHub parsing                                                                | Collector/provider tests under `src/lib/server/collectors/` and `src/lib/server/github/`                                  |
| Fingerprints, unchanged LOC cache, refresh policies, and five-minute scheduling                  | `src/lib/server/collectors/git.test.ts`, `src/lib/server/collectors/loc.test.ts`, and `tests/integration/scanner.test.ts` |
| Ignore globs, depth, canonical containment, symlink boundaries, and literal subprocess arguments | `src/lib/server/collectors/discover.test.ts` and `src/lib/server/collectors/process.test.ts`                              |

## Integration and failure coverage

| Plan fixture or boundary                                                                                                                | Automated evidence                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Normal/tagged repository, empty repository, dirty tree, linked worktree, spaces and Unicode                                             | Real temporary Git repositories in `discover.test.ts` and `git.test.ts`              |
| TD database absent, HTTP success, CLI fallback, >100 issues, timeout, malformed output, and missing CLI                                 | `src/lib/server/collectors/td.test.ts`                                               |
| GitHub success, cache reuse, rename by node ID, rate limit, invalid credentials, partial GraphQL/REST/traffic permissions, and recovery | `src/lib/server/collectors/github.test.ts`, `client.test.ts`, and `provider.test.ts` |
| Empty database and every prior schema fixture, idempotence, foreign keys, WAL, and constraints                                          | `tests/integration/catalog.test.ts` with `tests/fixtures/catalog/v0.sql`             |
| Concurrent manual/scheduled scans, durable leases, expired-run recovery, heartbeat, fencing, cancellation, and SSE replay               | `tests/integration/scanner.test.ts`                                                  |
| Collector failure isolation, cached LOC/TD preservation, hidden-project enrichment skip, and bounded 6/2 concurrency                    | `tests/integration/scanner.test.ts`                                                  |
| New/missing discovery reconciliation without silent deletion                                                                            | `src/lib/server/collectors/discover.test.ts` and `tests/integration/catalog.test.ts` |

## Browser, accessibility, and visual coverage

| User outcome                                                                                                       | Automated or executed manual evidence                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Cached list, all URL-backed sorts, search, filters, history, and favorite grouping                                 | `tests/e2e/home.test.ts`                                                                              |
| Pointer and keyboard reorder with reload persistence                                                               | `tests/e2e/home.test.ts`                                                                              |
| Favorite, note, hide, hidden search/detail, restore, decision controls, and persistence                            | `tests/e2e/home.test.ts`                                                                              |
| Scan start/SSE completion while retaining the URL and visible catalog, with focus on the invoking rescan control   | `tests/e2e/home.test.ts`                                                                              |
| Semantic names, keyboard navigation, skip link/focus ring, reduced motion, empty recovery, and 390 px no-overflow  | `tests/e2e/home.test.ts`                                                                              |
| Login/session/logout production flow                                                                               | `tests/e2e/auth.test.ts` with `playwright.auth.config.ts`                                             |
| Prototype fidelity for Ember and alternate theme, density, geometry, drawer, flyout, hidden/manual/degraded states | Manual screenshot comparison recorded in the `td-5700c4` log; artifacts live in `/tmp/ongoing-proof/` |

The deterministic browser catalog is built by `tests/e2e/seed.ts`. It includes fresh and stale
metrics, favorites, notes, multiple hidden projects, a Unicode path, dirty state, TD/GitHub data, unavailable
GitHub enrichment, attention views, snapshots, and manual ranks without depending on the developer's
live repositories.

## Release and operations coverage

| Release boundary                                                                                 | Executable evidence                                                                                                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Exact app-scoped Bun 1.3.1 and frozen dependency graph                                           | `.bun-version`, both plists, `scripts/provision-runtime.sh`, `tests/release.test.ts`; `bun install --frozen-lockfile`       |
| Format, lint, strict Svelte/type checks, unit/integration, and Playwright                        | Package scripts `format:check`, `lint`, `check`, `test`, `test:e2e`, and `test:e2e:auth`                                    |
| Raw fixed/chunked mutation ceiling before adapter actions and health without catalog leakage     | `scripts/production-server.ts`, `tests/production-server.test.ts`, `scripts/production-smoke.ts`, `bun run test:production` |
| Non-loopback authentication fails closed and valid sessions work                                 | Config/security tests plus `bun run test:e2e:auth`                                                                          |
| Production web scheduler disabled while development/manual/project scanning remains available    | `src/lib/server/config.test.ts`, `src/lib/server/scanning/automatic.test.ts`, `tests/integration/scanner.test.ts`           |
| Daily 04:00 scan definition, shared database/root, distinct labels, and no load/keepalive scan   | `config/ongoing-scan.plist.example`, `config/ongoing.plist.example`, `tests/release.test.ts`, `plutil -lint`                |
| Scan CLI/smoke and parameterized adapter boundaries                                              | `scripts/scan.ts`, `scripts/smoke.ts`, collector tests, and production smoke                                                |
| Exact-target, two-agent deploy/rollback dry-runs with no remote mutation                         | `tests/release.test.ts`, `bun run deploy -- --dry-run ...`, and `bun run rollback -- --dry-run ...`                         |
| Port 7766 health, SQLite persistence/backup, two-agent controls, update, rollback, and LAN smoke | Scripted and documented in `docs/deployment.md`; live-host verification belongs to the deployment checkpoint, not local QA  |
| Private remote and deployed commit identity                                                      | Verified at the deployment checkpoint because local release QA must not create or mutate remote infrastructure              |
