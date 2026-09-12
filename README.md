# ongoing

A software inventory for the repositories you actually work on: what exists, what it is built
with, how it relates to everything else, and which of it deserves a few hours this week.

Ongoing finds Git repositories on your disk, collects what it can about each one — commits, lines
of code, declared toolchains, open issues, GitHub stars and CI state — and keeps the result in a
SQLite catalog it owns. On top of that sits a dense, keyboard-first table you can filter, sort, and
edit in place, a fact sheet per entry, a technology radar, and a `Cmd+K` palette. Every one of those
is also a command, because the terminal is a first-class way to use this.

![The inventory, with an entry's detail panel open](docs/qa/screens/inventory-panel-dark.png)

## Install

You need [Bun](https://bun.sh) at the version in `.bun-version`, and Git.

```sh
git clone <this repository> ongoing && cd ongoing
bun install --frozen-lockfile
ln -s "$PWD/bin/ongoing" ~/.local/bin/ongoing     # anywhere on your PATH
```

## Start

```sh
ongoing init --scan-root ~/src        # a commented config.toml, a data directory, a catalog
ongoing scan                          # find the repositories under that root
ongoing list                          # what it found
ongoing serve                         # the browser, on http://127.0.0.1:4173
```

`init` writes `~/.config/ongoing/config.toml` and will not overwrite one that already exists. Those
three commands are the whole installation; the catalog is created the first time it is opened, and
every command works without a service running.

Nothing beyond Git is required. `td`, `cloc`, and the GitHub CLI make the catalog richer, and
`ongoing providers` says which of them this machine has:

```
$ ongoing providers
PROVIDER         STATE        SCHEDULE      LAST RUN  FIELDS  NOTE
filesystem       active       every-scan    2h ago         2  Discovers Git repositories under the configured scan roots
git              active       every-scan    2h ago        11  Commit history, branch, working-tree state, and tags
td               unavailable  every-scan    2h ago         6  td is not on PATH
loc              unavailable  when-changed  2h ago         4  cloc is not on PATH
github           active       when-changed  2h ago        17  Stars, pull requests, issues, CI state, releases, and traffic
```

A provider that is missing its tools contributes no fields at all, so the rules that read them go
quiet rather than wrong. A scan with none of the three still completes.

## What is in the catalog

An **entry**. Projects and technologies are both entries, separated by a `kind` — `project` and
`technology` today, anything else later without a rewrite. Every value an entry carries is a
**registered field**, and relations between entries are rows. That means a new field is not a
migration:

```sh
ongoing field add x.owner --type text        # registered everywhere, immediately
ongoing set td x.owner alice
ongoing list 'x.owner:alice'
```

Fields you did not add are there too — `intent`, `next_action`, `tags`, `git.commits30d`,
`github.stars`, `stack.go`, `complete` — and all of them filter, sort, and become columns the same
way, because the read model does not distinguish a value somebody typed from one a provider
collected.

## One query, every surface

Filtering, sorting, and column selection are a single grammar. The same string works as a CLI
argument, as the `?q=` parameter in the browser's URL, and as a saved view:

```sh
ongoing list 'intent:invest,maintain github.stars>=100 -tag:archived' --sort -git.commits30d,name
ongoing list 'view:upgrade tech:go' --columns name,stack.go,git.latestCommit --json
ongoing list 'complete<100'                  # what the inventory does not know about yet
ongoing list --saved oss-momentum
```

Clauses are ANDed. `field:value` matches any of a comma list, `!:` and a leading `-` negate,
`> >= < <=` compare, `:~` contains, `*` means "has a value", `none` means "has none". Bare text
searches name, slug, path, and note.

The browser's URL **is** that command — `?q=`, `?sort=`, `?columns=` carry exactly what
`ongoing list` would send — so a link someone pastes into a terminal is a query someone else can
run, and every button has a verb behind the same endpoint.

## Sweeps

There is no `ongoing each`. A query that prints paths composes with the shell you already have:

```sh
ongoing list 'tech:go stack.go<1.26' --paths | xargs -I{} -n1 go -C {} get -u ./...
ongoing list 'intent:invest' --paths | xargs -P4 -I{} git -C {} fetch --quiet
```

More patterns: [docs/cli.md](docs/cli.md).

## Attention, without a score

Ongoing does not compute a priority number. It runs seven independent, inspectable
classifications, and an entry's fact sheet shows every reason with its input, value, comparison,
and threshold — so a claim like "dormant" can be argued with. The browser re-runs the same rules
locally after an edit, so a decision moves a row immediately rather than a round trip later.

- **Needs attention** — missing from disk, an unresolved collector warning, fresh failing CI, fresh
  blocked or stale issues, an external PR at least 30 days old, or a project marked `invest` whose
  required fields are not filled in.
- **Rising** — 5 stars gained, 2 external issues, 25 traffic views, or 10 clones over 30 days.
- **Opportunity** — at most 5 commits in 30 days plus known external demand.
- **Momentum** — 10 commits, 5 active days, a merged PR, or a release in the last 30 days.
- **Quick wins** — at most 5,000 lines of code plus a backlog of 1 to 5 actionable items.
- **Dormant** — no commits in 30 days, latest commit 90 days old, no external demand, not `invest`.
- **Upgrade** — a declared toolchain past end of life or two supported releases behind.

Measurements have to have been collected within 72 hours to count. Null, stale, rate-limited, or
unavailable inputs never satisfy a rule. The thresholds are exported constants
(`ATTENTION_THRESHOLDS`) with boundary tests beside them; they are product policy, not weights.

## Technology radar

Each technology carries a **ring** (`hot`, `warm`, `cool`, `out`), and a project that uses one
holds a `uses` relation carrying the detected version. Edges are read out of committed manifests on
every scan, or declared by hand and left alone.

```sh
ongoing tech seed                  # the technologies Ongoing ships with; idempotent
ongoing tech show go               # every project using Go, with versions
ongoing tech set go --ring warm
ongoing list 'tech:go'
```

An `out` technology in use, or a ring past its review date, is an attention reason like any other.

## Configuration

One TOML file at `~/.config/ongoing/config.toml` (`--config` or `ONGOING_CONFIG` to move it), with
environment variables as overrides. `ongoing init` writes a commented one. Everything Ongoing
assumes is a **named adapter** you can switch off:

| Assumption                | Adapter                             | Turn it off with                        |
| ------------------------- | ----------------------------------- | --------------------------------------- |
| Repositories live on disk | the `filesystem` discovery provider | `[providers] disabled = ["filesystem"]` |
| GitHub is the host        | the `github` provider               | the same, or no token                   |
| `td` is the tracker       | the `td` provider                   | the same, or no `td` on PATH            |
| `cloc` counts the lines   | the `loc` provider                  | the same                                |
| endoflife.date is truth   | the `endoflife` provider            | the same                                |
| A service manager runs it | the host adapter                    | `[host] adapter = "foreground"`         |
| Deployment                | a profile in `deploy/<name>/`       | do not write one                        |

A repository does not have to be on this disk to be in the catalog: with
`[providers.github] discover = ["your-org"]`, a scan also catalogues the repositories that owner has
that nothing local claims. They show up with a source instead of a path, and no local metrics,
because that is the truth about them.

## Running it

```sh
ongoing serve                      # foreground, in this terminal
ongoing scan --full --wait
ongoing logs -f
```

Ongoing is built for **one trusted user on a private network**. `serve` binds loopback unless
`HOST` says otherwise, and a non-loopback listener refuses to start without `ONGOING_ACCESS_SECRET`.
Do not put it on the public internet. [docs/deployment.md](docs/deployment.md) covers binding
beyond loopback, running it under a service manager, and writing a deployment profile;
[docs/auth.md](docs/auth.md) covers the login.

## Development

| Command            | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `bun run dev`      | The development server, on loopback             |
| `bun run build`    | Build the adapter-node production application   |
| `bun run check`    | Generate SvelteKit types and run `svelte-check` |
| `bun run lint`     | ESLint and Prettier                             |
| `bun run format`   | Fix formatting                                  |
| `bun run test`     | Vitest                                          |
| `bun run test:e2e` | Playwright                                      |

SvelteKit 2, Svelte 5, TypeScript, Bun, SQLite. One TypeScript core under `src/lib/`; the CLI, the
API, and the browser are thin shells over it, and the domain rules are pure so the browser can
re-run them. [DESIGN.md](DESIGN.md) is the house style — tokens, components, and the keyboard map
with each key's CLI equivalent. The architecture decisions are in [docs/adr/](docs/adr/):
app-owned storage, provider boundaries, cache-first scanning, toolchain baselines, and the entry,
query, provider, and design-system decisions behind the current shape. How that shape was arrived at,
phase by phase, is [docs/plans/implemented/](docs/plans/implemented/).

Full CLI reference: [docs/cli.md](docs/cli.md). Operational notes for agents working in this
repository: [AGENTS.md](AGENTS.md).

## Publishing a catalog

Projects can carry explicit public copy and an opt-in flag, and `ongoing export` writes the catalog
through an **export profile** — `json` for anything, `opentangle` for the site the author publishes
from it. See [the website catalog contract](docs/website.md).

## License

MIT. See [LICENSE](LICENSE).
