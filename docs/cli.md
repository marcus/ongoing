# The `ongoing` command

`bin/ongoing` is a terminal client for the same dashboard the browser talks to. It is a client of
the HTTP API, not of the SQLite catalog: every read and write goes through `/api/*`, so the CLI and
the UI can never drift apart or disagree about validation. Only the service commands
(`build`, `dev`, `restart`, `stop`, `logs`, `repo`) touch the machine directly.

## Install

```sh
ln -s /Users/marcus/code/ongoing/bin/ongoing ~/.local/bin/ongoing
```

`bin/ongoing` is a `/bin/sh` wrapper that resolves the symlink and execs `bin/ongoing.ts` with the
app-scoped Bun at `~/.local/share/ongoing/bun` (falling back to whatever `bun` is on `PATH`). There
is nothing to rebuild after editing the CLI — it runs from source.

## Talking to the right instance

| Source         | Value                                               |
| -------------- | --------------------------------------------------- |
| `--url <base>` | highest precedence                                  |
| `ONGOING_URL`  | e.g. `http://aerie.local:7766` from another machine |
| default        | `http://127.0.0.1:7766`                             |

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

ongoing open [project] [--terminal|--github]
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
other field: `path`, `is_missing`, `views` (the attention views an entry is in — `view:` is its
alias), `warnings` (unresolved collector errors), `tech` (technologies linked by `uses`/`provides`),
`stack.lag`, `github.starsGained30d`, and `github.trafficViewsDelta30d`. `kind` is a field too, and
technology entries add `used_by`, `provided_by`, and `ring_stale`.

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
  `scripts/release-config.ts` and is asserted by `tests/release.test.ts`. Keep the two plists in
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
- `ongoing list --hidden` is the clause `is_hidden:true`, so the hidden shelf is reachable from
  every surface rather than only from the `/hidden` page.
- `ongoing list` reads `GET /api/entries`, which is the whole read contract. `/api/projects` is the
  project projection the current browser still renders, and it keeps its own parameters until the
  Phase 4 shell replaces it.

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
`missing`, `warnings`, one per attention view, one per toolchain as `stack-<toolchain>`, and
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

## HTTP endpoints behind these verbs

| Verb                        | Endpoint                                               |
| --------------------------- | ------------------------------------------------------ |
| `list`, `views`, `stacks`   | `GET /api/entries?q=&sort=&columns=&saved=`            |
| `show`, `status`            | `GET /api/projects` (the entry projection)             |
| `get`, `entry list`         | `GET /api/entries`, `GET /api/entries/:kind/:slug`     |
| `set`, `tag`, `untag`       | `PATCH /api/entries/:kind/:slug`                       |
| `entry add`, `entry remove` | `POST /api/entries`, `DELETE /api/entries/:kind/:slug` |
| `field list/add/remove`     | `GET/POST/DELETE /api/fields`                          |
| `link`, `unlink`            | `GET/POST/DELETE /api/relations`                       |
| `view list/save/delete`     | `GET/POST/PATCH/DELETE /api/views`                     |
| `tech list/show/export`     | `GET /api/entries?q=kind:technology`                   |
| `tech add`, `tech seed`     | `POST /api/entries`, `PATCH /api/entries/:kind/:slug`  |

## Website selection and public copy

`ongoing website <project> [--file <json>] [--include|--exclude]` reads or patches the project's explicit public metadata. New records default to draft. `ongoing website export` emits only selected public records; `--drafts` emits all configured records in a draft envelope. These commands always return JSON and use the same authenticated HTTP API as the rest of the CLI. See [the website contract](website.md) for fields, endpoints, migration behavior, and OpenTangle integration.

`--allow-private` grants the explicit public-site exception for a private or unverified repository; `--public-repo-only` restores the default. The override requires a distinct non-GitHub website destination. `ongoing website pages` lists standalone pages and `ongoing website page <slug>` accepts the same editing flags. All exports apply the shared eligibility rule.
