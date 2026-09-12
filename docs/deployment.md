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
`src/lib/host/scan-command.ts` against the same database and scan roots. Set
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
