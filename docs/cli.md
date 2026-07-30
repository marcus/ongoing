# The `ongoing` command

`bin/ongoing` is a terminal client for the same dashboard the browser talks to. It is a client of
the HTTP API, not of the SQLite catalog: every read and write goes through `/api/*`, so the CLI and
the UI can never drift apart or disagree about validation. Only the service commands
(`build`, `dev`, `restart`, `stop`, `logs`, `repo`) touch the machine directly.

## Install

```sh
ln -s /Users/marcus/code/ongoing/bin/ongoing ~/.local/bin/ongoing
```

`bin/ongoing` is a `/bin/sh` wrapper that resolves the symlink, reads `.bun-version`, and execs
`bin/ongoing.ts` with the app-scoped pinned Bun (falling back to whatever `bun` is on `PATH`). There
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

## Naming a project

Commands that take a project accept, in order of preference: the project id, an exact name, an
exact relative path, an absolute path, `.` for the working directory, or any unique substring of the
name or path. An ambiguous substring lists the candidates instead of guessing.

```sh
ongoing show .           # the repo you are standing in
ongoing show td          # exact name wins over the td-watch substring match
ongoing show snap        # unique substring
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
ongoing set <project> [--intent invest|maintain|experiment|hibernate|archive]
                      [--excitement 1-5] [--importance 1-5]
                      [--next-action <text>] [--review-after YYYY-MM-DD]
                                      every value also accepts "none" to clear it
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
  collectors. That agent's plist does not set `PATH`, so `cloc` is not on it and the `loc` collector
  records a warning; the daily scan agent sets `PATH` and does not have this problem. `bun run scan`
  in a shell is unaffected. This is the same behaviour as the dashboard's rescan button.
- `ongoing list --hidden` relies on `GET /api/projects?hidden=true`, added so the hidden shelf is
  not a UI-only capability.
