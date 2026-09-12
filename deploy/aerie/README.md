# The aerie deployment profile

Everything in this directory belongs to **one machine**: `marcus@aerie.local`. The application does
not import it, and `tests/foundation.test.ts` fails if it ever does. Deploying Ongoing somewhere else
means writing `deploy/<name>/` beside this one, not editing the core (ADR 0007).

| File                       | What it is                                                                    |
| -------------------------- | ----------------------------------------------------------------------------- |
| `release-config.ts`        | The aerie constants — host, checkout, database, labels, plists, runtime, PATH |
| `release-client.ts`        | The local half of a release: provisions the runtime, then invokes the worker  |
| `remote-release.ts`        | The worker that runs on aerie: quiesce, back up, build, migrate, bootstrap    |
| `deploy.ts`, `rollback.ts` | `bun run deploy` and `bun run rollback`                                       |
| `production-smoke.ts`      | Starts the built server on a temp catalog and runs the authentication smoke   |
| `provision-runtime.sh`     | Installs the Bun release named in `.bun-version` into Ongoing's own mise data |
| `config/*.plist.example`   | The two committed LaunchAgent definitions                                     |

## What the core keeps

The application's own entry points live in `src/lib/host/`: `production-server.ts` is the HTTP
boundary every host adapter starts, and `scan-command.ts` is one scan. `scripts/production-server.ts`
and `scripts/scan.ts` are **shims** onto them, kept because the plists installed on aerie name those
paths; the next deploy can point the plists at `src/lib/host/` and delete the shims. See
[docs/deployment.md](../../docs/deployment.md).

## Running a new machine without a profile

Nothing here is required to run Ongoing. A machine with no launchd, no aerie, and no profile does:

```sh
ongoing serve --data-dir ~/.local/share/ongoing --port 7766   # foreground host
ongoing scan
```

with `[host] adapter = "foreground"` in `~/.config/ongoing/config.toml`.
