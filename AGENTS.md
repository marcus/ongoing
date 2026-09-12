# AGENTS.md

Operational notes for agents working in this repo. See [README.md](README.md) for product/architecture context.

## The `ongoing` CLI is the fastest way to inspect the running app

`bin/ongoing` (symlinked to `~/.local/bin/ongoing`) drives the live dashboard from the shell:
`ongoing status`, `ongoing list --view attention --json`, `ongoing show <project>`, `ongoing scan --wait`,
`ongoing logs -f`, `ongoing restart --build`. It is a client of the HTTP API, so anything the UI can do it can
do — keep that parity when adding features, and add the flag alongside the button. Reference:
[docs/cli.md](docs/cli.md). It runs from source; there is nothing to rebuild after editing it.

## Auth is intentionally disabled

`ONGOING_DISABLE_AUTH=true` is set in the production launchd plist. This is a **deliberate, standing choice** for
this local-network-only app — do not re-enable auth or "fix" this without being asked. Details: [docs/auth.md](docs/auth.md).

Consequence: the same-origin/CSRF check in `src/hooks.server.ts` is also skipped whenever
`authenticationRequired` is false (see `isSameOriginMutation`), since it adds no protection once auth is off and
was blocking legitimate LAN requests (e.g. the favorites toggle, when accessed via a hostname that doesn't match
the configured `APP_ORIGIN`).

## There is an active redesign, and it is settled

[docs/plans/active/ongoing-inventory-redesign.md](docs/plans/active/ongoing-inventory-redesign.md) turns Ongoing
from a projects dashboard into a software inventory: typed entries over a field registry, one query grammar for
every surface, collectors declared as providers behind a host adapter, and a rebuilt frontend. The reasoning is in
ADRs [0005](docs/adr/0005-entry-model-and-field-registry.md), [0006](docs/adr/0006-one-query-grammar.md),
[0007](docs/adr/0007-provider-manifests-and-host-adapters.md), and
[0008](docs/adr/0008-frontend-design-system.md). Each phase has a td epic named in its section of the plan.

Before adding a table, a column, a list parameter, or a collector, check whether the plan already says where it
goes. New capability order is unchanged: domain function, repository method, API route, CLI verb, then UI.

**Phase 1 has landed.** The catalog is `entries` + `entry_sources` + `fields` + `relations` + `saved_views`; the
`projects` table is gone and the metric tables are keyed by `entry_id`. Do not add a column for a new per-entry
value — register a field. `validateEntryPatch(registry, kind, patch)` in `src/lib/domain/fields.ts` is the only
path from an untrusted patch to stored values, and the API, the CLI, and (from Phase 4) the browser all call it.
`/api/projects` is now the project projection of the same entries and stays until the new shell ships.

**Phase 2 has landed.** Reading the catalog is one query grammar: `src/lib/domain/query.ts` parses and
evaluates it, `GET /api/entries?q=&sort=&columns=&saved=` is the single read endpoint, and `ongoing list`
is a thin shell over it. Do not add a list parameter — add a clause, or a field for one to address. The
old `view`/`filter`/`stack`/`search`/`sort` parameters survive as clause aliases through
`legacyParamsToQuery`, whose table is printed in [docs/cli.md](docs/cli.md) and asserted in
`src/lib/domain/query.test.ts`. Saved views ship built-in, declared in `src/lib/domain/view.ts`.

## Keep the architecture model current

`docs/diagrams/fractal/` holds the Fractal model of this system (`model.c4`, `fractal.json`,
`sequences.json`) and its exported scenes under `artifacts/`. When a change alters the design — a new
subsystem, route, collector, provider, store, boundary, or journey, or a proposal that lands — update the
affected elements, scenes, and journeys in the same change, keep stable `uid` values, cite the source files
you touched as evidence, and re-run `~/code/fractal/bin/fractal validate --directory docs/diagrams/fractal --json`
before committing. Re-export scenes you changed with `bin/fractal export`. Do not model every file; model
responsibilities. Authoring guidance: `~/code/fractal/skills/fractal/SKILL.md`.

## Restarting the production service

Production runs as the launchd agent `com.marcusvorwaller.ongoing`, serving `http://aerie.local:7766` (also
reachable as `http://localhost:7766` from this machine). **It runs a prebuilt adapter-node bundle in `build/`, not
source directly** — editing `src/` does nothing to the running service until you rebuild:

```sh
bun run build
launchctl bootout gui/$(id -u)/com.marcusvorwaller.ongoing
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
```

`launchctl kickstart -k` restarts the process but does **not** reload the plist file itself — use bootout +
bootstrap when the plist changed. Logs: `~/Library/Logs/Ongoing/{stdout,stderr}.log`.

The daily scanner is a separate agent, `com.marcusvorwaller.ongoing.scan`, on its own plist — restart it the same
way if you change scanner code.

## Committing and pushing

Always commit and push your work to `main` when it is done, unless told otherwise. Don't leave finished changes
sitting in the working tree waiting for someone to ask.

Before committing:

- `bun run lint` (ESLint + Prettier)
- `bun run test` (Vitest)
- `bun run check` (svelte-kit sync + svelte-check) — may be blocked by the sandbox in some agent environments; if
  so, note that explicitly rather than skipping silently.

## Styling

All dashboard styling lives in one file: `src/lib/components/dashboard/dashboard.css`. There is no
`--font-size-base` variable or Tailwind config — every `font-size` is an absolute px value declared per component,
so an app-wide font bump means editing every `font-size:` line in that file, not just the `body` rule.
