# Deployment

Deployment is a **profile**, not part of the application. Everything specific to one machine — its
host name, its checkout, its database path, its service definitions, its release scripts — lives in
`deploy/<name>/`, and the core never imports it (ADR 0007, asserted by `tests/foundation.test.ts`).
This repository ships one profile, [`deploy/aerie/`](../deploy/aerie/README.md), as a worked example
and as the author's own deployment; a different machine writes its own beside it, or runs with no
profile at all.

Ongoing is designed for **one trusted user on a private network**. It is not hardened for public
exposure. Do not add router forwarding, a public tunnel, or public DNS. Move to HTTPS before using
it on a less-trusted network.

## No profile at all

Two commands, and a third if you want the browser:

```sh
ongoing init                  # a commented config.toml, a data directory, and a catalog
ongoing scan                  # find the repositories under the configured roots
ongoing serve                 # the application, in this terminal
```

`ongoing init` writes `[host] adapter = "foreground"`, which supervises nothing. That is the whole
installation: no service manager, no deployment scripts, no profile directory.

## Binding beyond loopback

`serve` listens on `127.0.0.1` unless `HOST` says otherwise, and the application decides whether
authentication is required from that same value — so a service that means to be reachable on the
network has to say so, and then has to say how it is protected:

```sh
HOST=0.0.0.0 PORT=7766 APP_ORIGIN=http://server.local:7766 \
  ONGOING_ACCESS_SECRET="$(openssl rand -hex 32)" ongoing serve
```

A non-loopback `HOST` refuses to start without `ONGOING_ACCESS_SECRET`. The one way around that is
`ONGOING_DISABLE_AUTH=true`, which is a deliberate choice for a trusted private network and nothing
else — see [auth.md](auth.md). Plain HTTP on a LAN also needs `SESSION_COOKIE_SECURE=false`, or the
browser discards the session cookie.

## Running it as a service

`serve`, `scan`, `restart`, `stop`, and `logs` go through a **host adapter** (`[host] adapter`):

| Adapter      | What it is                                                                    |
| ------------ | ----------------------------------------------------------------------------- |
| `foreground` | No supervisor. The process runs in the terminal that started it. The default. |
| `launchd`    | Two user LaunchAgents on macOS: one serving, one scanning on a calendar.      |

The `launchd` adapter finds its agents by looking in `~/Library/LaunchAgents` for the definitions
that serve and scan Ongoing, whatever reverse-DNS label their installer chose; `[host] label` names
them outright when they cannot be discovered. Another supervisor — systemd, Docker, a process
manager — is a new file in `src/lib/host/`, not a change to the CLI.

Whatever starts the service should run `src/lib/host/production-server.ts`. That is the HTTP
boundary: it counts raw fixed-length and chunked mutation bytes before SvelteKit actions, then
forwards bounded requests to a private ephemeral loopback adapter listener. A scheduled scan runs
`scripts/scan.ts` with `ONGOING_URL` pointing at the service. It invokes `ongoing scan --transport http
--wait --json`; collector configuration and migrations belong exclusively to the deployed web process.
If that service is unavailable, the job exits unsuccessfully without opening a database. Authenticated
installations can provide `ONGOING_ACCESS_SECRET` or an existing CLI session. `bun run scan` and
`ongoing scan --local` remain explicit source-based tools for standalone catalogs, not calendar jobs. Set
`ONGOING_ENABLE_SCAN_SCHEDULER=false` on the web process when a scheduler already owns the scan, so
it creates neither the startup scan nor the five-minute interval. The durable scan lease prevents
two scans from overlapping however they were started.

## Writing a profile

A profile is a directory. Put in it the constants that name your machine, whatever release script
you want, and your service definitions; import the core from it, never the other way round.
[`deploy/aerie/`](../deploy/aerie/README.md) is the worked example, including a release worker that
quiesces the agents, backs up the catalog, builds, migrates, and verifies health before it finishes.
A profile's own tests live beside it (`deploy/**/*.test.ts` is in the Vitest suite), which is where
machine-specific strings belong.

## Upgrading Bun

`.bun-version` is the only place the Bun version is written down, and
`tests/foundation.test.ts` fails if anything else restates it. Bumping Bun is editing that file,
running `bun install` to refresh `bun.lock`, and deploying.

## Build and activation lifecycle

`bun run build` stages adapter-node output in a new `.ongoing-builds/<id>/` directory. Only a
successful build containing `handler.js` atomically replaces the `build` symlink. The production
server resolves that link once at startup; routes, lazy imports, and static assets keep using the
same directory for its entire lifetime. A build does not migrate the catalog or activate code.
`ongoing restart --build` builds, then restarts through the host adapter to activate it.

Builds are serialized with `.ongoing-builds/build.lock`, because Vite also shares `.svelte-kit/`.
If an interrupted build leaves the lock behind, verify no build process is running before removing
that directory. Use `bun run build`, not a direct Vite invocation, for publishable bundles.

Older installations have a real `build/` directory. Builds refuse to replace it, since an old
process might still import files there. Stop all Ongoing servers, then adopt the existing bundle
once from the checkout (choose an unused destination):

```sh
ongoing stop
# Wait until every Ongoing server has exited before moving any files.
mkdir -p .ongoing-builds
mv build .ongoing-builds/legacy
ln -s .ongoing-builds/legacy build
ongoing restart
```

The updated launcher resolves the symlink before importing. Ordinary builds are now safe. If started
against a legacy directory before adoption, it snapshots that bundle for its own use; that does not
make it safe to move another process's files.

Old builds are retained deliberately: removing one while a process still imports it recreates the
original outage. During maintenance, stop all Ongoing servers and remove only unused build
directories, keeping the directory selected by `build`. Failed staging directories can be removed
after their build process exits. Code rollback does not roll back schema migrations; keep a catalog
backup when deploying schema changes, and use the deployment profile's database recovery workflow. Rich-field artifacts live beside the database under `artifacts/`; deployment snapshots and restores that directory together with SQLite so field references never outlive their files.
