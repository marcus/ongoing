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

## Keep the architecture model current

`docs/diagrams/fractal/` holds the Fractal model of this system (`model.c4`, `fractal.json`,
`sequences.json`) and its exported scenes under `artifacts/`. When a change alters the design — a new
subsystem, route, collector, provider, store, boundary, or journey, or a proposal that lands — update the
affected elements, scenes, and journeys in the same change, keep stable `uid` values, cite the source files
you touched as evidence, and re-run `~/code/fractal/bin/fractal validate --directory docs/diagrams/fractal --json`
before committing. Re-export scenes you changed with `bin/fractal export`. Do not model every file; model
responsibilities. Authoring guidance: `~/code/fractal/skills/fractal/SKILL.md`.

## Pinned Bun version

The exact Bun version is pinned in multiple places and must be kept in sync: `.bun-version`, `package.json`
(`packageManager` + `engines.bun` + `@types/bun`), both `config/*.plist.example` files, both installed plists in
`~/Library/LaunchAgents/`, `scripts/provision-runtime.sh`, and `scripts/release-config.ts`
(`PRODUCTION_BUN_VERSION` / `PRODUCTION_BUN`). `tests/release.test.ts` and `tests/foundation.test.ts` assert this
consistency — if you bump the version, update every file above, then `bun install` to refresh `bun.lock`, and
reinstall the pinned Bun into the app-scoped mise dir:

```sh
MISE_DATA_DIR=/Users/marcus/.local/share/ongoing/mise mise install bun@<version>
```

Currently pinned: `1.3.9`.

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
bootstrap when the plist changed (e.g. after a Bun version bump). Logs: `~/Library/Logs/Ongoing/{stdout,stderr}.log`.

The daily scanner is a separate agent, `com.marcusvorwaller.ongoing.scan`, on its own plist — restart it the same
way if you change scanner code.

## Before committing

- `bun run lint` (ESLint + Prettier)
- `bun run test` (Vitest — currently 162 tests)
- `bun run check` (svelte-kit sync + svelte-check) — may be blocked by the sandbox in some agent environments; if
  so, note that explicitly rather than skipping silently.

## Styling

All dashboard styling lives in one file: `src/lib/components/dashboard/dashboard.css`. There is no
`--font-size-base` variable or Tailwind config — every `font-size` is an absolute px value declared per component,
so an app-wide font bump means editing every `font-size:` line in that file, not just the `body` rule.
