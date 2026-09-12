# AGENTS.md

Operational notes for agents working in this repo. See [README.md](README.md) for product/architecture context.

## The `ongoing` CLI is the fastest way to inspect the running app

`bin/ongoing` (symlinked to `~/.local/bin/ongoing`) drives the live dashboard from the shell:
`ongoing status`, `ongoing list --view attention --json`, `ongoing show <project>`, `ongoing scan --wait`,
`ongoing providers`, `ongoing logs -f`, `ongoing restart --build`. It speaks the same HTTP contract the UI
does, so anything the UI can do it can do — keep that parity when adding features, and add the flag alongside
the button. Reference: [docs/cli.md](docs/cli.md). It runs from source; there is nothing to rebuild after
editing it.

**It works with no service running.** The CLI probes `/api/health` and links the core library into its own
process when nothing answers (`src/lib/server/api/local.ts`), so `ongoing scan` and `ongoing list` work on a
bare machine. Both transports call the same library functions — add a capability to the library, not to a
route, or the two paths will drift.

## Auth is intentionally disabled

`ONGOING_DISABLE_AUTH=true` is set in the production launchd plist. This is a **deliberate, standing choice** for
this local-network-only app — do not re-enable auth or "fix" this without being asked. Details: [docs/auth.md](docs/auth.md).

Consequence: the same-origin/CSRF check in `src/hooks.server.ts` is also skipped whenever
`authenticationRequired` is false (see `isSameOriginMutation`), since it adds no protection once auth is off and
was blocking legitimate LAN requests (e.g. the favorites toggle, when accessed via a hostname that doesn't match
the configured `APP_ORIGIN`).

## The redesign is implemented, and it is the shape of the app

[docs/plans/implemented/ongoing-inventory-redesign.md](docs/plans/implemented/ongoing-inventory-redesign.md) turned
Ongoing from a projects dashboard into a software inventory: typed entries over a field registry, one query grammar
for every surface, collectors declared as providers behind a host adapter, and a rebuilt frontend. All six phases
are built; each section carries the handoff for what it left behind, and the closing Handoff lists what a person
still has to do by hand. The reasoning is in
ADRs [0005](docs/adr/0005-entry-model-and-field-registry.md), [0006](docs/adr/0006-one-query-grammar.md),
[0007](docs/adr/0007-provider-manifests-and-host-adapters.md), and
[0008](docs/adr/0008-frontend-design-system.md). Each phase has a td epic named in its section of the plan.

Before adding a table, a column, a list parameter, or a collector, check whether the plan already says where it
goes. New capability order is unchanged: domain function, repository method, API route, CLI verb, then UI.

**Phase 1 has landed.** The catalog is `entries` + `entry_sources` + `fields` + `relations` + `saved_views`; the
`projects` table is gone and the metric tables are keyed by `entry_id`. Do not add a column for a new per-entry
value — register a field. `validateEntryPatch(registry, kind, patch)` in `src/lib/domain/fields.ts` is the only
path from an untrusted patch to stored values, and the API, the CLI, and (from Phase 4) the browser all call it.
`/api/projects` is the project projection of the same entries; the new shell does not use it, but `ongoing
show` and `ongoing status` still do.

**Phase 2 has landed.** Reading the catalog is one query grammar: `src/lib/domain/query.ts` parses and
evaluates it, `GET /api/entries?q=&sort=&columns=&saved=` is the single read endpoint, and `ongoing list`
is a thin shell over it. Do not add a list parameter — add a clause, or a field for one to address. The
old `view`/`filter`/`stack`/`search`/`sort` parameters survive as clause aliases through
`legacyParamsToQuery`, whose table is printed in [docs/cli.md](docs/cli.md) and asserted in
`src/lib/domain/query.test.ts`. Saved views ship built-in, declared in `src/lib/domain/view.ts`.

**Phase 3 has landed.** Technologies are entries with `kind = 'technology'`, a ring, and a tool
surface; a usage is a `uses` relation carrying the detected version. `src/lib/domain/technology.ts`
holds the seed list, the signature table that is the whole detector, and the deterministic export.
Detection runs inside the stack collector's parse pass and its edges belong to the `tech-signatures`
provider — rewritten whole on every scan, never hand-edited — while declared edges survive scans
untouched. Do not add a technologies table or a `/api/technologies` route: `ongoing tech` reads
`GET /api/entries?q=kind:technology` like everything else. Adding a technology means adding a seed
in `technology.ts`, and a signature beside it only if a manifest can see it. The `project-standards`
skill's language and tool tables are generated from `ongoing tech export` by
`scripts/render-project-standards.ts`; edit the catalog, then regenerate.

**Phase 4 has landed.** The browser is the inventory shell: a rail, a table over chosen columns with
inline editors, a detail panel on `Enter`, fact sheets at `/p/<slug>` and `/t/<slug>`, the radar at
`/radar`, providers at `/providers`, and `Cmd+K`. Everything lives under `src/routes/(inventory)/`,
which is one route group over one `+layout.server.ts` that loads the whole catalog once; filtering,
sorting, and column changes are `filterRows`/`sortRows` in the browser, so a list operation costs no
round trip. **The URL is the query** — `?q=`, `?sort=`, `?columns=`, `?saved=` carry the same strings the
CLI carries, and `listDefaultClauses` is shared with `ongoing list` so a URL and a CLI invocation are the
same command. Edits are optimistic with undo through `src/lib/domain/optimistic.ts`, which re-runs
`validateEntryPatch` and `classifyAttentionViews` locally before the server answers. Do not add a button
without a CLI verb: `tests/e2e/inventory.test.ts` drives `bin/ongoing` against the same server for every
browser mutation it makes. `dashboard.css`, the ticker, the flyout, the drawer, the project list and row,
drag reorder, and the `/hidden` page are gone; `?saved=hidden` is the hidden shelf now.

**Phase 5 has landed.** Every collector is a provider with a manifest in `src/lib/domain/provider.ts`: it
declares its kinds, its namespaced read-only fields, the relation kinds it writes, what it needs from the
machine, and its schedule. The registry is built from the manifests, so a disabled or unavailable provider
registers no fields and the rules that read them go inert. Do not add a projected field to a hand table — add
it to the provider's manifest. The scanner iterates `activeProviders(...)` in `dependsOn` order rather than a
fixed sequence; a provider failure still never fails a scan, and a skipped one records why in `provider_runs`.

Configuration is one TOML file, `~/.config/ongoing/config.toml` (`--config` or `ONGOING_CONFIG` to move it), read by
`loadRuntimeConfig`; `loadConfig(env, file)` stays pure so no test touches the real file. Environment
variables are overrides, and precedence is env > file > default. `serve`, `scan`, `restart`, `stop`, and
`logs` go through a host adapter in `src/lib/host/` (`launchd`, `foreground`) — the CLI must not learn about
launchd again. Deployment is a profile in `deploy/aerie/` that the core never imports;
`tests/foundation.test.ts` fails if it does. `scripts/production-server.ts` and `scripts/scan.ts` are shims
onto `src/lib/host/` because the installed plists name those paths.

**Phase 6 has landed, and the plan is implemented.** Completeness is a count over the registry's
`required` fields, projected as `complete` (0–100) — `ongoing list 'complete<100'`, the `incomplete`
saved view, and an attention reason for a project marked `invest` with gaps. Do not add a
"completeness" concept anywhere: mark a field `required` and it counts. A project entry does not have
to be on this disk — `[providers.github] discover` catalogues repositories nothing local claims, and
those entries have a `github` source and **no path**, so never assume `entry.path` is a string.
`ongoing init` + `ongoing serve` is the whole installation, and `docs/deployment.md` is now generic:
anything naming one person, one host, or one home directory belongs in `deploy/<name>/` or the
`opentangle` export profile, and `tests/foundation.test.ts` fails the build if it appears under
`src/`, `bin/`, `scripts/`, or `tests/`. A profile's own tests live beside it
(`deploy/**/*.test.ts` is in the Vitest suite). CI runs the same five commands in
`.github/workflows/ci.yml`.

## Keep the architecture model current

`docs/diagrams/fractal/` holds the Fractal model of this system (`model.c4`, `fractal.json`,
`sequences.json`) and its exported scenes under `artifacts/`. When a change alters the design — a new
subsystem, route, collector, provider, store, boundary, or journey, or a proposal that lands — update the
affected elements, scenes, and journeys in the same change, keep stable `uid` values, cite the source files
you touched as evidence, and re-run `fractal validate --directory "$PWD/docs/diagrams/fractal" --json`
(an **absolute** `--directory`: a relative one resolves against Fractal's own checkout, which validates
Fractal's model and reports a much smaller element count that looks like data loss but is not)
before committing. Re-export scenes you changed with `bin/fractal export`. Do not model every file; model
responsibilities. Authoring guidance: `~/code/fractal/skills/fractal/SKILL.md`.

## Restarting the production service

Production runs as the launchd agent `com.marcusvorwaller.ongoing`, serving `http://aerie.local:7766` (also
reachable as `http://localhost:7766` from this machine). **It runs a prebuilt adapter-node bundle in `build/`, not
source directly** — editing `src/` does nothing to the running service until you rebuild:

```sh
ongoing restart --build     # the launchd host adapter does the bootout/bootstrap dance
```

**`bun run build` on its own takes the running service down.** Vite writes new hash-named chunks and
deletes the old ones, and SvelteKit imports them lazily, so the live process keeps a manifest
pointing at files that no longer exist and every route but `/api/health` answers 500 with
`Cannot find module './entries/…'`. Build and restart together, or do not build against a running
agent.

or, by hand:

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

Every colour, size, weight, and duration resolves to a token in `src/lib/ui/tokens.css`. **No component
declares a `font-size` in pixels or a colour literal** — that was exactly the problem with the
`dashboard.css` monolith this replaced, where an app-wide type change meant editing 1,468 lines.

The house style is written down in [DESIGN.md](DESIGN.md): the tokens, the components in `src/lib/ui/`,
the keyboard map with each key's CLI equivalent, and the places the design deliberately departs from the
Linear patterns it started from. Read it before adding a screen, a component, or a colour. Screens are
recorded in `docs/qa/screens/` (dark and light); regenerate with
`QA_SCREENSHOTS=1 E2E_PORT=7801 bun run test:e2e tests/e2e/screenshots.test.ts`.
