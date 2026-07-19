# ongoing

A private, single-user dashboard for deciding which local software projects deserve attention. Ongoing discovers Git repositories, caches local and provider metrics in an app-owned SQLite catalog, and presents them using the interaction and visual direction in `docs/mockups/dashboard.html`.

The repository currently contains the Bun and SvelteKit application foundation. Catalog and scanner implementation follows in later stories.

## Local setup

1. Install Bun `1.3.1` (the exact version in `.bun-version`).
2. Run `bun install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and adjust the local paths if needed.
4. Run `bun run dev` and open `http://127.0.0.1:5173`.

Development and preview bind to loopback by default. Production may set `HOST` and `PORT` explicitly when the service is intentionally exposed on the private LAN.

## Commands

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `bun run dev`          | Start the loopback-only development server                |
| `bun run build`        | Build the adapter-node production application             |
| `bun run preview`      | Preview the build on loopback                             |
| `bun run check`        | Generate SvelteKit types and run `svelte-check`           |
| `bun run lint`         | Run ESLint and verify formatting                          |
| `bun run format`       | Format source and documentation                           |
| `bun run format:check` | Verify formatting only                                    |
| `bun run test`         | Run the Vitest suite                                      |
| `bun run test:e2e`     | Run Playwright browser tests                              |
| `bun run scan`         | Run the scanner CLI (placeholder until the catalog story) |

LAN authentication and production operations are documented in [docs/deployment.md](docs/deployment.md). Non-loopback listeners fail closed unless `ONGOING_ACCESS_SECRET` is configured; do not expose this trusted-LAN application to the public internet.

## Architecture

The full product plan lives in `docs/plans/ongoing-projects-dashboard.md`. The initial architectural constraints are recorded in `docs/adr/`: app-owned storage, provider boundaries, and cache-first bounded scanning.

## Attention views

Attention views are separate, transparent classifications implemented in `src/lib/domain/attention.ts`; Ongoing does not calculate a grand priority score. The drawer shows every matching reason with its input, value, comparison, and threshold. Git, LOC, TD, GitHub, and traffic measurements must have been collected successfully within 72 hours. Null, invalid, stale, rate-limited, unauthenticated, or unavailable inputs do not satisfy metric rules.

Current thresholds:

- Needs attention: a missing repository, unresolved collector warning, fresh failing CI, one or more fresh blocked/stale TD items, or an external PR at least 30 days old.
- Rising: at least 5 stars gained, 2 external issues, 25 additional traffic views, or 10 additional clones over 30 days.
- Opportunity: at most 5 commits in 30 days plus known external demand (100 stars, an external PR, or a recent external issue).
- Momentum: at least 10 commits or 5 active days in 30 days, a merged PR, or a release in the last 30 days.
- Quick wins: at most 5,000 lines of code plus a known actionable TD or GitHub backlog of 1–5 items.
- Dormant: no commits in 30 days, latest commit at least 90 days old, fresh evidence of no external PRs/recent issues/star growth, and intent is not `invest`.

These values are product policy rather than score weights. Tune the exported `ATTENTION_THRESHOLDS` constants and their boundary tests together.
