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
ongoing [list]                        list projects (the default command)
  --view <attention|rising|quickwin|opportunity|momentum|dormant|upgrade>
  --filter <all|favorites|missing|warnings|local>
  --stack <go|node|bun|deno|python|ruby|rust|php|elixir|dotnet|java|swift|postgresql>
  --sort <key> [--asc|--desc]         any sort key the dashboard offers
  -q, --search <text>                 name, path, or note
  -n, --limit <count>
  --hidden                            the hidden shelf instead of the dashboard
  --paths | --ids | --json            machine-readable output
ongoing show <project>                everything, including why each attention view matched
ongoing get <entry> [field]           every field an entry carries; one field prints its value
ongoing views                         attention view counts
ongoing stacks [toolchain]            declared toolchains, versions in use, upgrade pressure
  --outdated                          only declarations that are behind or end-of-life
  plus every `list` narrowing flag (--view, --filter, --search, --hidden)
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

ongoing open [project] [--terminal|--github]
ongoing logs [-f] [--lines N] [--scan]
ongoing restart [--build] [--scan]
ongoing stop [--scan]
ongoing build | dev | repo | login
```

`--json` works on every command that reads or changes catalog data, and colour is dropped when
stdout is not a TTY or `NO_COLOR` is set, so the CLI composes:

```sh
ongoing list --view attention --json | jq -r '.[] | select(.errors | length > 0) | .name'
ongoing list --stack go --view upgrade --paths        # every Go project that needs a bump
ongoing stacks --json | jq -r '.[] | "\(.toolchain) \(.outdated)/\(.projects) outdated"'
for path in $(ongoing list --filter favorites --paths); do git -C "$path" fetch --quiet; done
```

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
- `ongoing list --hidden` relies on `GET /api/projects?hidden=true`, added so the hidden shelf is
  not a UI-only capability.

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

A saved view is a name for a query plus the columns to show. Phase 2 of the inventory redesign gives
the query string its grammar; today it is stored and handed back verbatim.

```sh
ongoing view save oss-momentum 'intent:invest github.stars>=100' --columns name,github.stars
ongoing view list
ongoing view delete oss-momentum
```

## HTTP endpoints behind these verbs

| Verb                              | Endpoint                                               |
| --------------------------------- | ------------------------------------------------------ |
| `list`, `show`, `views`, `stacks` | `GET /api/projects` (the entry projection)             |
| `get`, `entry list`               | `GET /api/entries`, `GET /api/entries/:kind/:slug`     |
| `set`, `tag`, `untag`             | `PATCH /api/entries/:kind/:slug`                       |
| `entry add`, `entry remove`       | `POST /api/entries`, `DELETE /api/entries/:kind/:slug` |
| `field list                       | add                                                    | remove` | `GET/POST/DELETE /api/fields`      |
| `link`, `unlink`                  | `GET/POST/DELETE /api/relations`                       |
| `view list                        | save                                                   | delete` | `GET/POST/PATCH/DELETE /api/views` |

## Website selection and public copy

`ongoing website <project> [--file <json>] [--include|--exclude]` reads or patches the project's explicit public metadata. New records default to draft. `ongoing website export` emits only selected public records; `--drafts` emits all configured records in a draft envelope. These commands always return JSON and use the same authenticated HTTP API as the rest of the CLI. See [the website contract](website.md) for fields, endpoints, migration behavior, and OpenTangle integration.

`--allow-private` grants the explicit public-site exception for a private or unverified repository; `--public-repo-only` restores the default. The override requires a distinct non-GitHub website destination. `ongoing website pages` lists standalone pages and `ongoing website page <slug>` accepts the same editing flags. All exports apply the shared eligibility rule.
