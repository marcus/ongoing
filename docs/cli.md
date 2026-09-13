# The `ongoing` command

`bin/ongoing` is a terminal client for the same dashboard the browser talks to. Every read and
write goes through the same `/api/*` contract the browser uses, so the CLI and the UI can never
drift apart or disagree about validation. Only the host commands (`build`, `dev`, `serve`,
`restart`, `stop`, `logs`, `repo`) touch the machine directly.

**It does not need a running service.** `ongoing` picks its transport: if something answers
`/api/health` it speaks HTTP to it, and otherwise it links the core library into its own process
and opens the catalog directly, so `ongoing scan` and `ongoing list` work on a machine with no
daemon (Decision 1). Both transports call the same library functions, so the answer is the same
either way. `--remote` forces HTTP, `--local` forces the in-process path, and naming `--url` or
`ONGOING_URL` always means HTTP.

## Install

```sh
ln -s "$PWD/bin/ongoing" ~/.local/bin/ongoing
```

`bin/ongoing` is a `/bin/sh` wrapper that resolves the symlink and execs `bin/ongoing.ts` with the
app-scoped Bun at `~/.local/share/ongoing/bun` (falling back to whatever `bun` is on `PATH`). There
is nothing to rebuild after editing the CLI — it runs from source.

## Talking to the right instance

| Source         | Value                                                |
| -------------- | ---------------------------------------------------- |
| `--url <base>` | highest precedence; always uses the HTTP transport   |
| `ONGOING_URL`  | e.g. `http://server.local:7766` from another machine |
| default        | `http://127.0.0.1:7766`, then the in-process path    |

`--transport auto|http|local` (or `ONGOING_TRANSPORT`) overrides the probe. `ongoing status`
prints which transport answered, and shows the catalog path rather than a URL when it was local.

Auth is normally disabled ([docs/auth.md](auth.md)). If it is re-enabled, `ongoing login <secret>`
(or `ONGOING_ACCESS_SECRET` in the environment) exchanges the access secret for a session cookie
stored at `~/.config/ongoing/session` with mode 600; a 401 mid-command retries the login once.

## Naming a project, or any other entry

The catalog holds **entries**: a project is an entry with `kind = project`, a technology is an entry
with `kind = technology`, and further kinds arrive without a schema change. Commands that take one
accept, in order of preference: the id, `kind/slug`, the slug, an exact name, an exact relative
path, an absolute path, `.` for the working directory, or any unique substring of the name or path.
An ambiguous substring lists the candidates instead of guessing.

```sh
ongoing show .                # the repo you are standing in
ongoing show td               # exact name wins over the td-watch substring match
ongoing get project/ongoing   # kind and slug, the form URLs use
ongoing get sveltekit         # a technology, by slug
```

## Commands

```
ongoing [list] ['<query>']            list entries matching a query (projects by default)
  --sort <[-]field,[-]field>          multiple keys; a leading - sorts descending
  --columns <a,b,c>                   render (and, with --json, emit) these fields
  --saved <name>                      start from a saved view's query and columns
  -n, --limit <count>                 show only the first N
  --count                             print how many match and stop
  --hidden                            the hidden shelf instead of the dashboard
  --paths | --ids | --json            machine-readable output
  --view | --filter | --stack | --tech | --kind | -q, --search | --asc | --desc
                                      the pre-query flags, kept as clause aliases (table below)
ongoing show <project>                everything, including why each attention view matched
ongoing get <entry> [field]           every field an entry carries; one field prints its value
ongoing views [--all]                 saved views, built-in and user, with how many each matches
ongoing stacks [toolchain] ['<query>']  declared toolchains, versions in use, upgrade pressure
  --outdated                          only declarations that are behind or end-of-life
  plus every `list` narrowing flag and any query clause
ongoing status                        service, agent, scan, and catalog health
ongoing path <project>                print the directory (`cd $(ongoing path td)`)

ongoing favorite <project> [--off]
ongoing hide <project> [--off]
ongoing unhide <project>
ongoing note <project> [text] [--clear]
ongoing forget <project>              drop it from the catalog for good
ongoing prune [-n, --dry-run]         forget every entry whose directory is gone
ongoing set <entry> <field> <value>   set any registered field; "none" clears it
ongoing set <project> [--intent invest|maintain|experiment|hibernate|archive]
                      [--excitement 1-5] [--importance 1-5]
                      [--next-action <text>] [--review-after YYYY-MM-DD]
                                      the original flags, kept as aliases for the same fields

ongoing entry list [--kind <kind>]    every entry, projects and technologies alike
ongoing entry add <kind> <name> [--slug s] [key=value ...]
ongoing entry remove <entry> --yes    drop a hand-made entry (projects use `forget`)
ongoing field list [--kind <kind>]    the field registry: built-in, provider, and user fields
ongoing field add <key> --type <type> [--label ...] [--kind ...] [--values a,b] [--required]
ongoing field remove <key> --yes      drop a user field and every value stored under it
ongoing tag <entry> [tag ...] [--clear]
ongoing untag <entry> <tag ...>
ongoing link <entry> uses|provides|depends_on|part_of <entry> [--note ...]
ongoing unlink <entry> <kind> <entry>
ongoing view list | view save <name> [query] [--columns a,b] [--kind <kind>] | view delete <name>
ongoing scan [project] [--full|--cheap] [--wait]

ongoing tech list ['<query>']          the technologies in the catalog, in ring order
  --ring hot|warm|cool|out            only one ring
  --kind language|framework|library|service|tool|platform
  --stale                             only rings whose review date has passed
  --unused                            only technologies no project uses
ongoing tech show <technology>        ring, note, and every project using it with versions
ongoing tech add <slug> --kind <kind> --ring <ring> [--name ...] [--note ...] [--tool-surface ...]
ongoing tech set <technology> [--ring ...] [--kind ...] [--note ...] [--tool-surface ...]
                              [--review-after YYYY-MM-DD]
ongoing tech seed [--file <json>] [--force]
                                      seed the technologies Ongoing ships with; idempotent
ongoing tech export [--pretty]        technologies and edges as one deterministic document

ongoing providers [name] [--verbose] [--json]
                                      every provider: availability, last run, contributed
                                      fields, enable state, and why it cannot run
ongoing export [--profile opentangle|json] [--drafts] [--kind <kind>] [--compact]
                                      publish the catalog through an export profile

ongoing open [project] [--terminal|--github]
ongoing serve [--data-dir <dir>] [--port N] [--bind <host>] [--no-build]
ongoing logs [-f] [--lines N] [--scan]
ongoing restart [--build] [--scan]
ongoing stop [--scan]
ongoing build | dev | repo | login
```

## Querying the inventory

Filtering, sorting, and column selection are **one grammar**, parsed and evaluated by pure
functions in `src/lib/domain/query.ts` and shared verbatim by the CLI, `GET /api/entries`, and the
browser ([ADR 0006](adr/0006-one-query-grammar.md)). The same string works as a CLI argument, a
`?q=` parameter, and the body of a saved view.

```
filter   := clause (' ' clause)*
clause   := ['-'] (field op value | 'tag:' value | 'view:' value | 'tech:' slug | 'kind:' kind | text)
op       := ':' | '!:' | '>' | '>=' | '<' | '<=' | ':~'
value    := token | token ',' token ...
sort     := ['-'] field (',' ['-'] field)*
```

Clauses combine with **and**; a comma inside a value is **or**; a leading `-` negates a clause.
There are no parentheses and no `or` between clauses: a question that needs them is a saved view or
a `jq` pipeline over `--json`.

| Operator    | Means          | Example                            |
| ----------- | -------------- | ---------------------------------- |
| `:`         | equals any of  | `intent:invest,maintain`           |
| `!:` or `-` | does not equal | `intent!:archive`, `-tag:archived` |
| `>` `>=`    | greater than   | `github.stars>=100`                |
| `<` `<=`    | less than      | `git.commits30d<5`                 |
| `:~`        | contains       | `note:~"parser cleanup"`           |
| `:*`        | has any value  | `stack.go:*`                       |
| `:none`     | has no value   | `intent:none`                      |

Field types drive the comparison, so `git.commits30d>9` is arithmetic rather than alphabetical:
`number` and `integer` compare numerically, `date` chronologically, `enum` and `multi_enum` are
equals-any, `boolean` reads `true`/`yes`/`1`, and `text` is exact for `:` and substring for `:~`.
A token with a space or a comma in it goes in quotes. Anything that is not a `field op value` clause
is **bare text**, matched against `name`, `slug`, `path`, and `note`.

Every key is a key in the field registry — stored, user-added, and provider-projected alike — so an
unknown one is an error naming the closest registered key rather than an empty result:

```
$ ongoing list 'intnet:invest'
error GET /api/entries failed (400): Unknown field: intnet — did you mean intent?
```

`--sort` takes several keys, each optionally prefixed with `-` for descending, and missing values
always sort last. Favourites float to the top of `ongoing list` unless `--no-group`.

```sh
ongoing list 'intent:invest,maintain github.stars>=100 -tag:archived' --sort -git.commits30d,name
ongoing list 'view:upgrade tech:go' --columns name,stack.go,git.latestCommit --json
ongoing list 'is_missing:true' --paths
ongoing list --saved oss-momentum
ongoing list 'kind:technology ring:hot' --columns name,technology_kind
```

### The old flags, as clauses

Every pre-query flag and `/api/entries` parameter still works and is translated into exactly this
clause before anything is evaluated (`legacyParamsToQuery` in `src/lib/domain/query.ts`; each row is
asserted in `src/lib/domain/query.test.ts`).

| Old flag / parameter    | Clause               | Note                                                        |
| ----------------------- | -------------------- | ----------------------------------------------------------- |
| `--view attention`      | `view:attention`     | any attention view key                                      |
| `--filter all`          | _(nothing)_          |                                                             |
| `--filter favorites`    | `is_favorite:true`   |                                                             |
| `--filter missing`      | `is_missing:true`    |                                                             |
| `--filter warnings`     | `warnings>0`         | narrower: also use `view:attention` for the other half      |
| `--filter local`        | `github.repoId:none` | no repository on the hosting provider                       |
| `--stack go`            | `stack.go:*`         | declares a version for that toolchain                       |
| `--tech go`             | `tech:go`            | linked to that technology by `uses` or `provides`           |
| `--kind technology`     | `kind:technology`    | `ongoing list` adds `kind:project` when you name none       |
| `-q`, `--search <text>` | `<text>`             | bare text over name, slug, path, note                       |
| `--hidden`              | `is_hidden:true`     | the default is `is_hidden:false`                            |
| `--sort latestCommit`   | `-git.latestCommit`  | the old sort keys below; they keep their descending default |
| `--asc` / `--desc`      | direction            | applies to keys with no `-` prefix                          |
| `--no-group`            | drops `-is_favorite` | favourites are a leading sort key, not a second pass        |

| Old sort key             | Field                                                      |
| ------------------------ | ---------------------------------------------------------- |
| `manual`                 | `manual_rank`                                              |
| `latestCommit`           | `git.latestCommit`                                         |
| `commits30d`             | `git.commits30d`                                           |
| `activeDays30d`          | `git.activeDays30d`                                        |
| `linesOfCode`            | `loc.code`                                                 |
| `lifetimeCommits`        | `git.commitCount`                                          |
| `openTdIssues`           | `td.total`                                                 |
| `githubStars`            | `github.stars`                                             |
| `githubStarsGained30d`   | `github.starsGained30d`                                    |
| `githubOpenPrs`          | `github.openPrs`                                           |
| `githubOldestExternalPr` | `github.oldestExternalPr`                                  |
| `githubTraffic`          | `github.trafficViews`                                      |
| `stackLag`               | `stack.lag`                                                |
| `name`                   | `name` — and so sorts A→Z, not Z→A as `?sort=name` used to |

One deliberate difference: `--filter warnings` used to match a project with a collector warning
**or** one in the attention view. The grammar has no `or` between clauses, so `warnings>0` is the
first half and `view:attention` is the second. Everything else behaves as it did.

### Derived fields the query model added

These are computed by the read model rather than stored, and are filterable and sortable like any
other field: `complete`, `path`, `is_missing`, `views` (the attention views an entry is in —
`view:` is its alias), `warnings` (unresolved collector errors), `tech` (technologies linked by
`uses`/`provides`), `stack.lag`, `github.starsGained30d`, and `github.trafficViewsDelta30d`. `kind`
is a field too, and technology entries add `used_by`, `provided_by`, and `ring_stale`.

**`complete`** is the share of a kind's `required` fields that carry a value, from 0 to 100. Which
fields those are is the registry's answer, not a hard-coded list: a project requires `kind`, `name`,
`slug`, `intent`, and `next_action`, a technology requires `ring` and `technology_kind`, and
`ongoing field add x.owner --type text --required` adds one of your own. A project marked
`intent:invest` that is not complete is a reason in `view:attention`, with the missing keys named.

```sh
ongoing list 'complete<100'                        # what the inventory does not know yet
ongoing list --saved incomplete                    # the same query, with the columns to fix it
ongoing list 'intent:invest complete<100' --json   # commitments with a gap
ongoing get td complete
```

`--json` works on every command that reads or changes catalog data, and colour is dropped when
stdout is not a TTY or `NO_COLOR` is set, so the CLI composes:

```sh
ongoing list 'view:attention' --json | jq -r '.[] | select(.errors | length > 0) | .name'
ongoing list 'view:upgrade stack.go:*' --paths        # every Go project that needs a bump
ongoing stacks --json | jq -r '.[] | "\(.toolchain) \(.outdated)/\(.projects) outdated"'
for path in $(ongoing list 'is_favorite:true' --paths); do git -C "$path" fetch --quiet; done
ongoing list 'intent:invest review_after<2026-10-01' --count
```

`ongoing list --json` emits the full entry views. With `--columns` (or a saved view that carries
them) it emits one object per entry holding just `id`, `entry`, and the chosen fields, which is
usually what a script wants.

## Notes

- `restart` uses `bootout` + `bootstrap` (not `kickstart`) so plist edits take effect, waits for
  launchd to finish tearing the job down, and retries the bootstrap — see
  [AGENTS.md](../AGENTS.md). `restart --build` rebuilds first and refuses to restart a failed build.
- `scan` starts a run through the API, which means the web LaunchAgent's environment runs the
  collectors — the same as the dashboard's rescan button. Both plists now set the same `PATH`, so
  `cloc`, `td`, `gh`, and `git` all resolve; that PATH is `PRODUCTION_SCAN_PATH` in
  the deployment profile's own constants and is asserted by that profile's test. Keep the two plists in
  sync when it changes.
- `forget` removes one project; `prune` removes every entry whose directory has been gone long
  enough. Both are permanent — the note, favourite, intent, and manual rank go with the row — so
  both require `--yes`; a bare `ongoing prune` reports what would go without touching anything.
- Two guards keep a live project from being deleted. Only a definitive `ENOENT` counts as gone, so
  a project that is merely undiscoverable — hidden by an ignore glob, below the depth limit, or
  under an unreadable parent — stays flagged missing. And absence must persist for
  `ONGOING_FORGET_MISSING_AFTER_DAYS` (default 7), because a rename, a directory moved aside, and
  an unmounted volume are indistinguishable from a deletion at a single moment. Put the directory
  back inside that window and the row is restored intact. `--grace-days 0` skips the wait;
  `ONGOING_FORGET_MISSING=false` disables automatic forgetting entirely.
- Forgetting is not a tombstone. A project that still exists on disk reappears on the next scan
  with an empty note, so `forget` is for entries you want gone, not projects you want ignored —
  use `hide` for those.
- `forget` and `prune --yes` return 409 while a scan is running, since removing a row underneath a
  scan would fail the run. Each forgotten project is logged to the service log by name and path.
- `ongoing list --hidden` is the clause `is_hidden:true`, so the hidden shelf is a query rather
  than a page; the browser reaches it the same way, at `/?saved=hidden`.
- `ongoing list` reads `GET /api/entries`, which is the whole read contract — and so does the
  browser, whose `?q=`, `?sort=`, `?columns=`, and `?saved=` are the same strings these flags
  produce. `listDefaultClauses` in `src/lib/domain/query.ts` is shared by both, which is why a URL
  and an `ongoing list` invocation return the same rows. `/api/projects` is the project projection
  `ongoing show` and `ongoing status` still read for their attention reasons.

## Fields, relations, and views

Every value an entry carries is a **registered field**: built-in fields declared in code (`intent`,
`excitement`, `strategic_importance`, `next_action`, `manual_rank`, `note`, `tags`, `review_after`,
and for technologies `ring`, `technology_kind`, `tool_surface`), read-only provider fields projected
from the collectors (`git.commits30d`, `github.stars`, `td.open`, `loc.code`, `stack.go`), and user
fields anyone can add at runtime. There is no migration behind a new field.

```sh
ongoing field add x.customer --type text --label Customer
ongoing set ongoing x.customer acme       # immediately editable, listable, and in --json
ongoing get ongoing x.customer            # acme
ongoing field remove x.customer --yes     # takes the stored values with it
```

`ongoing set` validates before it sends, using the same pure function the API and the browser run,
so a typo names the closest registered key and a read-only field is refused by name:

```
$ ongoing set ongoing intnet invest
error Unknown field: intnet — did you mean intent?
$ ongoing set ongoing github.stars 5
error Field github.stars is read-only (provider:github)
```

Rich JSON fields name a trusted presentation adapter and optional semantic role. Their values are immutable artifact references, so ordinary `set` refuses them; import and revision checks use the attachment command. The project argument is its stable exact ID. `none` means the field must not already have a selection.

```sh
ongoing field add identity.logo --type json --kind project --adapter impressions.logo.v1 --role identity
ongoing attachment get <project-id> --field identity.logo --remote --json
ongoing attachment set <project-id> --field identity.logo --file bundle.json --expected none --remote --json
ongoing attachment export <project-id> --field identity.logo --output ./logo-export --json
```

An Impressions v1 bundle contains `kind: "impressions.logo.bundle"`, `version: 1`, its portable `document`, and `poster: { mediaType: "image/png", base64: "..." }`. Ongoing validates the document through its installed adapter, validates and hashes the PNG, stores both files beside the catalog, and writes only their hashes and the acknowledged revision into the field. A conflict returns the current revision without replacing the selected value. Public website inclusion remains a separate explicit policy.

Relations are rows between entries, with the kinds they may connect declared up front — `uses` and
`provides` run project → technology, `depends_on` and `part_of` project → project. Edges written by
hand are `declared`; a provider's detected edges are rewritten on every scan and never hand-edited.

```sh
ongoing entry add technology SvelteKit --slug sveltekit technology_kind=framework ring=hot
ongoing link ongoing uses sveltekit --note "the app is a SvelteKit app"
ongoing get sveltekit                      # shows the incoming edge
ongoing unlink ongoing uses sveltekit
```

A saved view is a name for a query plus the columns to show — a bookmark, not a second query
language. Ongoing ships a set of built-in views declared in code (`all`, `favorites`, `hidden`,
`missing`, `warnings`, `incomplete`, one per attention view, one per toolchain as `stack-<toolchain>`, and
`technologies`), so a fresh database and an upgraded one agree without a migration. Saving a view
with a built-in's name shadows it; deleting a built-in is refused.

```sh
ongoing views                              # every view with how many entries it matches
ongoing view save oss-momentum 'intent:invest github.stars>=100' --columns name,github.stars
ongoing list --saved oss-momentum
ongoing list --saved stack-go --columns name,stack.go
ongoing view delete oss-momentum
```

## The radar

A technology is an entry with `kind = 'technology'`, its **ring** is a registered field, and a usage
edge is a `uses` relation carrying the version the manifest declared. Four rings, ordered: `hot` is
the default choice for new work, `warm` is fine to keep using, `cool` needs a reason, and `out` is
"do not start new work on it" — which is why `out` in use is an `upgrade` reason. Every ring carries
a `review_after`, and a ring past its review date puts the projects using it in `attention`, the
same way a stale project decision does.

```sh
ongoing tech seed                          # the technologies Ongoing ships with
ongoing tech list --ring hot               # what is current, in ring order
ongoing tech show go                       # every Go project, with the version each declares
ongoing tech set python --ring cool --review-after 2027-01-01
ongoing list 'tech:go stack.go<1.26' --paths   # a fleet sweep, from the same query model
```

`ongoing tech seed` is idempotent by construction: a missing technology is created, a field the
catalog has not filled in is filled, and a value someone has since changed is left alone — so a
re-seed after `ongoing tech set go --ring warm` does not undo the edit. `--force` overwrites with
the seeded values, and `--file` seeds from a JSON file with the same shape instead of the built-in
list. Seeding also declares the `provides` edge for a technology one of the catalogued projects
supplies (`td`, `sidecar`, `comms`, …).

Edges come from two places and never fight. **Declared** edges are written by hand
(`ongoing link ongoing uses sveltekit --note "the app shell"`) and survive every scan. **Detected**
edges belong to the `tech-signatures` provider, which reads dependency manifests inside the stack
collector's pass — `package.json`, `go.mod`, `Gemfile`, `Cargo.toml`, `composer.json` — plus marker
files like `.todos/config.json`, and takes languages from the toolchains the same pass collected.
They are rewritten whole on every scan, so a dependency dropped from a manifest loses its edge, and
they are never edited by hand. A signature exists only for a technology already in the catalog: a
dependency nobody catalogued is invisible.

Technology entries carry three derived fields — `used_by` (how many projects use it), `provided_by`,
and `ring_stale` — so every `tech list` flag is an ordinary clause:

```sh
ongoing list 'kind:technology ring:out' --columns name,used_by
ongoing list 'kind:technology ring_stale:true'
ongoing list --saved technologies
```

`ongoing tech export` prints technologies and their edges in ring order with each project list
sorted, so a generator that renders it twice produces the same bytes. That is what
`scripts/render-project-standards.ts` reads to regenerate the language and tool tables in the
`project-standards` skill.

## Configuration

Configuration is **one TOML file**, `~/.config/ongoing/config.toml`, with `--config <file>` or
`ONGOING_CONFIG` to point elsewhere. `--config` is a global flag: it applies to every command,
including `serve`, which passes it on to the server it starts. Environment variables remain
overrides and keep carrying secrets, so the installed LaunchAgents run unchanged. Precedence, highest first:

1. an environment variable (`SCAN_ROOTS`, `PORT`, `DATABASE_PATH`, `ONGOING_PROVIDERS`, ...)
2. the configuration file
3. the built-in default

A missing file is not an error - it means "all defaults". An unknown section or key **is** an
error, so a typo fails at start-up instead of silently doing nothing.

```toml
[server]
port = 7766
database = "~/Library/Application Support/Ongoing/ongoing.sqlite"

[scan]
roots = ["~/code"]
max_depth = 3
scheduler = false

# Every shipped provider is on unless configuration turns it off.
# `enabled` narrows the list; `disabled` subtracts from whatever is left.
[providers]
enabled = ["filesystem", "git", "td", "stack", "tech-signatures", "loc", "endoflife", "github"]
disabled = []

[providers.filesystem]
roots = ["~/code"]
max_depth = 3
forget_missing_after_days = 7

[providers.github]
token_env = "GH_TOKEN"
# Owners — users or organisations — whose repositories are catalogued even when nothing local
# claims them. Empty by default: a scan does not start listing somebody's account on its own.
discover = []
include_forks = false
include_archived = false

[providers.endoflife]
api_url = "https://endoflife.date/api/v1"
max_age_hours = 24

[host]
adapter = "launchd"   # or "foreground"

[export]
profile = "opentangle"
```

| Environment override                    | What it does                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `ONGOING_CONFIG`                        | read this file instead of `~/.config/ongoing/config.toml` (same as `--config`) |
| `ONGOING_PROVIDERS`                     | comma-separated enabled list, replacing the file's                             |
| `ONGOING_DISABLE_PROVIDERS`             | comma-separated list to switch off                                             |
| `ONGOING_HOST_ADAPTER`                  | `launchd` or `foreground`                                                      |
| `ONGOING_TRANSPORT`                     | `auto`, `http`, or `local`                                                     |
| `ONGOING_GITHUB_DISCOVER`               | comma-separated GitHub owners to catalogue remote-only repositories for        |
| `ONGOING_ENABLE_RELEASE_BASELINE=false` | still turns the `endoflife` provider off                                       |

### Remote-only entries

An entry is a project because a provider found it, not because it is on this disk. With
`[providers.github] discover = ["acme"]`, a scan also catalogues the repositories that owner has
that no local checkout claims: each becomes an entry with a `github` source, a locator of
`owner/name`, and **no filesystem source** — so it has no `path`, no git, LOC, td, or stack values,
and nothing in the UI or the CLI pretends otherwise. GitHub's own fields (`github.stars`,
`github.openIssues`, CI state, releases, traffic) are collected exactly as they are for a local
project.

Forks and archived repositories are left out unless `include_forks` or `include_archived` says
otherwise, and a repository a local checkout already claims is never catalogued twice. What this
provider creates it also owns: a remote-only entry whose repository has been cloned locally or no
longer exists is dropped on the next scan — unless somebody has written a note or a tag on it, in
which case it stays. Nothing is dropped on a scan where listing an owner failed.

```sh
ongoing list 'path:none'                   # everything with no local checkout
ongoing get acme-atlas                     # the fact sheet: source, not path
ongoing set acme-atlas intent experiment   # edited like any other entry
```

`ongoing show` reads the project projection, which is the _local_ view of a project, so it points
you at `ongoing get` for a remote-only entry rather than inventing a path for it.

## Providers

Every collector is a **provider with a manifest** (ADR 0007): it declares the entry kinds it
touches, the namespaced read-only fields it owns, the relation kinds it writes, what it needs from
the machine, and how often it runs. The scanner iterates the enabled providers in dependency order
rather than running a fixed sequence, and a provider that is switched off or missing its tools
registers **no fields at all**, so every rule that reads them goes inert rather than wrong.

```
$ ongoing providers
PROVIDER         STATE        SCHEDULE      LAST RUN  FIELDS  NOTE
filesystem       active       every-scan    2h ago         2  Discovers repositories under the configured scan roots
git              active       every-scan    2h ago        11  Commit history, branch, working-tree state, and tags
td               unavailable  every-scan    2h ago         6  td is not on PATH
stack            active       every-scan    2h ago        14  Declared toolchain versions read from committed manifests
tech-signatures  active       every-scan    2h ago         -  Detected `uses` edges from manifest dependency signatures
loc              disabled     when-changed  2h ago         4  disabled in configuration
endoflife        active       daily         2h ago         -  Release cycles and end-of-life dates for declared toolchains
github           active       when-changed  2h ago        17  Stars, pull requests, issues, CI state, releases, and traffic

host adapter: launchd - configuration: ~/.config/ongoing/config.toml
```

`ongoing providers <name>` prints one manifest in full, and `--json` emits the same payload
`GET /api/providers` returns:

```
$ ongoing providers github
github  active
  Stars, pull requests, issues, CI state, releases, and traffic for GitHub remotes
  schedule    when-changed
  kinds       project
  depends on  filesystem, git
  requires    gh, network
  last run    2h ago - ok
  fields      github.repoId github.oldestExternalPr github.owner github.name github.visibility
              github.isArchived github.stars github.forks github.watchers github.openIssues
              github.openPrs github.externalPrs github.ciState github.latestRelease
              github.trafficViews github.starsGained30d github.trafficViewsDelta30d
```

`STATE` is `active`, `disabled` (configuration said so), or `unavailable` (a required command is
not on `PATH`, a required variable is not set, or something it depends on is not running). An
unavailable provider records that it was skipped and contributes nothing; it never fails the scan
and never writes a collector warning.

## Running the application

Two commands are the whole installation:

```sh
ongoing init                       # a commented config.toml, a data directory, and a catalog
ongoing scan                       # find the repositories under the configured roots
ongoing serve                      # the browser, in this terminal
```

`init` writes `~/.config/ongoing/config.toml` (`--config` puts it elsewhere), makes the data
directory, and opens the catalog once so the migrations run. It refuses to overwrite an existing
configuration file unless `--force`, because that file is where a person's choices live.

```sh
ongoing init ~/.local/share/ongoing --scan-root ~/src,~/work --port 7801
ongoing init --config ./ongoing.toml --data-dir ./.ongoing --json
```

`serve`, `scan`, `restart`, `stop`, and `logs` go through a **host adapter**. `foreground`
supervises nothing and runs the application in the terminal — it is what `init` writes and what a
machine with no service manager uses. `launchd` drives two user LaunchAgents on macOS.
`[host] adapter` chooses it, `ONGOING_HOST_ADAPTER` and `--host` override.

```sh
ongoing serve --data-dir ~/.local/share/ongoing --port 7766   # foreground, fresh catalog
ongoing scan --full --wait
ongoing restart --build            # launchd reloads the plist rather than kickstarting the job
ongoing logs -f --scan
```

## Fleet sweeps

There is no `ongoing each`. A query that prints paths and a shell that runs commands over them
already compose, and the composition is more useful than a verb would be: `xargs`, `parallel`,
a `for` loop, `git -C`, and every tool that takes a directory all work unchanged.

```sh
# every Go project on a version behind the baseline, upgraded one at a time
ongoing list 'tech:go stack.go<1.26' --paths | xargs -I{} -n1 go -C {} get -u ./...

# fetch everything you have said you are investing in
ongoing list 'intent:invest' --paths | xargs -P4 -I{} git -C {} fetch --quiet

# run a command in each project and keep going when one fails
ongoing list 'view:attention' --paths | while read -r path; do
  ( cd "$path" && bun run lint ) || echo "lint failed in $path"
done

# the gaps, as a checklist
ongoing list 'complete<100' --columns name,intent,next_action --json | jq -r '.[] | .name'

# ids, for anything that wants the catalog's own handle
ongoing list 'is_favorite:true' --ids | xargs -n1 ongoing get
```

`--paths` prints nothing for an entry with no local checkout, so a sweep over remote-only entries
is a no-op rather than an error. `--ids` and `--json` carry them like any other entry.

A `--data-dir` nobody has written to becomes a catalog on first open, which is all a new install
needs: no launchd, no deployment profile, no configuration file.

## Export profiles

Publishing the catalog is an adapter too. `opentangle` is the shape OpenTangle's site build reads;
`json` is the generic profile beside it - entries with their field values, relations by
`kind/slug`, and the field registry, sorted so the same catalog always produces the same bytes.

```sh
ongoing export --profile opentangle            # what GET /api/website returns
ongoing export --profile opentangle --drafts   # every configured record, marked draft
ongoing export --profile json                  # the whole catalog
ongoing export --profile json --kind technology --compact
```

`ongoing website export` stays as the `opentangle` profile under its old name.

## HTTP endpoints behind these verbs

| Verb                        | Endpoint                                                |
| --------------------------- | ------------------------------------------------------- |
| `list`, `views`, `stacks`   | `GET /api/entries?q=&sort=&columns=&saved=`             |
| `show`, `status`            | `GET /api/projects` (the entry projection)              |
| `get`, `entry list`         | `GET /api/entries`, `GET /api/entries/:kind/:slug`      |
| `set`, `tag`, `untag`       | `PATCH /api/entries/:kind/:slug`                        |
| `entry add`, `entry remove` | `POST /api/entries`, `DELETE /api/entries/:kind/:slug`  |
| `field list/add/remove`     | `GET/POST/DELETE /api/fields`                           |
| `link`, `unlink`            | `GET/POST/DELETE /api/relations`                        |
| `view list/save/delete`     | `GET/POST/PATCH/DELETE /api/views`                      |
| `tech list/show/export`     | `GET /api/entries?q=kind:technology`                    |
| `tech add`, `tech seed`     | `POST /api/entries`, `PATCH /api/entries/:kind/:slug`   |
| `providers`                 | `GET /api/providers`                                    |
| `export`                    | `GET /api/export?profile=&drafts=&kind=`                |
| `website export`            | `GET /api/website` (the `opentangle` profile)           |
| `scan`                      | `POST /api/scan`; `--wait` reads `GET /api/scan?runId=` |

Every one of these is answered identically by the in-process transport when no service is running.
`serve`, `restart`, `stop`, and `logs` have no endpoint: they are the host adapter, not the API.

## Website selection and public copy

`ongoing website <project> [--file <json>] [--include|--exclude]` reads or patches the project's explicit public metadata. New records default to draft. `ongoing website export` emits only selected public records; `--drafts` emits all configured records in a draft envelope. These commands always return JSON and use the same authenticated HTTP API as the rest of the CLI. See [the website contract](website.md) for fields, endpoints, migration behavior, and OpenTangle integration.

`--allow-private` grants the explicit public-site exception for a private or unverified repository; `--public-repo-only` restores the default. The override requires a distinct non-GitHub website destination. `ongoing website pages` lists standalone pages and `ongoing website page <slug>` accepts the same editing flags. All exports apply the shared eligibility rule.
