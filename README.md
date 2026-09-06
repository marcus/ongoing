# ongoing

Always check if you are running in Sidecar: run `sidecar --agents` for capabilities.

A private, single-user dashboard for deciding which local software projects deserve attention. Ongoing discovers Git repositories, caches local and provider metrics in an app-owned SQLite catalog, and presents them using the interaction and visual direction in `docs/mockups/dashboard.html`.

The complete Bun and SvelteKit application includes the local catalog, scanner, personal organization controls, TD and GitHub enrichment, attention views, LAN authentication, and private-host release tooling.

## Local setup

1. Install Bun `1.3.9` (the exact version in `.bun-version`).
2. Run `bun install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and adjust the local paths if needed.
4. Run `bun run dev` and open `http://127.0.0.1:5173`.

Development and preview bind to loopback by default. Production may set `HOST` and `PORT` explicitly when the service is intentionally exposed on the private LAN.

## Commands

| Command                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `bun run dev`          | Start the loopback-only development server      |
| `bun run build`        | Build the adapter-node production application   |
| `bun run preview`      | Preview the build on loopback                   |
| `bun run check`        | Generate SvelteKit types and run `svelte-check` |
| `bun run lint`         | Run ESLint and verify formatting                |
| `bun run format`       | Format source and documentation                 |
| `bun run format:check` | Verify formatting only                          |
| `bun run test`         | Run the Vitest suite                            |
| `bun run test:e2e`     | Run Playwright browser tests                    |
| `bun run scan`         | Run one scanner CLI refresh                     |

## The `ongoing` command

`bin/ongoing` is a terminal client for the dashboard, installed on `PATH` with
`ln -s "$PWD/bin/ongoing" ~/.local/bin/ongoing`. It reads and writes through the same HTTP API the
browser uses, so listing, filtering, favorites, hiding, notes, decision fields, and scans are
available to a shell or an agent exactly as they are to the UI:

```sh
ongoing                                   # every project, dashboard ordering
ongoing list --view attention --json      # machine-readable attention view
ongoing show .                            # the repo you are standing in, with attention reasons
ongoing set td --intent invest            # the same fields the drawer edits
ongoing stacks                            # declared toolchains, versions in use, upgrade pressure
ongoing list --stack go --view upgrade    # Go projects whose toolchain is behind or end-of-life
ongoing scan --full --wait
```

Full reference: [docs/cli.md](docs/cli.md).

LAN authentication and production operations are documented in [docs/deployment.md](docs/deployment.md). Non-loopback listeners fail closed unless `ONGOING_ACCESS_SECRET` is configured; do not expose this trusted-LAN application to the public internet.

The production source of truth is the private repository `git@github.com:marcus/ongoing.git`. Its tested `main` branch deploys to `/Users/marcus/code/ongoing` on `aerie.local`. The web LaunchAgent `com.marcusvorwaller.ongoing` serves `http://aerie.local:7766`; the separate `com.marcusvorwaller.ongoing.scan` LaunchAgent refreshes the shared catalog once daily at 03:00 local time.

## Architecture

The full product plan lives in `docs/plans/ongoing-projects-dashboard.md`. The initial architectural constraints are recorded in `docs/adr/`: app-owned storage, provider boundaries, cache-first bounded scanning, and toolchain release baselines.

## Attention views

Attention views are separate, transparent classifications implemented in `src/lib/domain/attention.ts`; Ongoing does not calculate a grand priority score. The drawer shows every matching reason with its input, value, comparison, and threshold. Git, LOC, TD, stack, GitHub, and traffic measurements must have been collected successfully within 72 hours. Null, invalid, stale, rate-limited, unauthenticated, or unavailable inputs do not satisfy metric rules.

Current thresholds:

- Needs attention: a missing repository, unresolved collector warning, fresh failing CI, one or more fresh blocked/stale TD items, or an external PR at least 30 days old.
- Rising: at least 5 stars gained, 2 external issues, 25 additional traffic views, or 10 additional clones over 30 days.
- Opportunity: at most 5 commits in 30 days plus known external demand (100 stars, an external PR, or a recent external issue).
- Momentum: at least 10 commits or 5 active days in 30 days, a merged PR, or a release in the last 30 days.
- Quick wins: at most 5,000 lines of code plus a known actionable TD or GitHub backlog of 1–5 items.
- Dormant: no commits in 30 days, latest commit at least 90 days old, fresh evidence of no external PRs/recent issues/star growth, and intent is not `invest`.
- Upgrade: a declared toolchain whose release cycle is past end of life, or that is at least 2 supported release cycles behind the newest one. Requires both fresh stack data and release-baseline data collected within 14 days.

These values are product policy rather than score weights. Tune the exported `ATTENTION_THRESHOLDS` constants and their boundary tests together.

## Public website catalog

Projects can carry explicit public website copy and an opt-in inclusion flag through `ongoing website` and the HTTP API. OpenTangle exports selected projects on its next deployment; dashboard notes and scanned metadata stay private. See [the website catalog contract](docs/website.md).
