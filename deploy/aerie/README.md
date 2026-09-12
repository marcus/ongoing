# The aerie deployment profile

Everything in this directory belongs to **one machine**: `marcus@aerie.local`. The application does
not import it, and `tests/foundation.test.ts` fails if it ever does. Deploying Ongoing somewhere else
means writing `deploy/<name>/` beside this one, not editing the core (ADR 0007).

| File                       | What it is                                                                    |
| -------------------------- | ----------------------------------------------------------------------------- |
| `release-config.ts`        | The aerie constants — host, checkout, database, labels, plists, runtime, PATH |
| `release.test.ts`          | The profile's own test: it asserts those constants and the committed plists   |
| `release-client.ts`        | The local half of a release: provisions the runtime, then invokes the worker  |
| `remote-release.ts`        | The worker that runs on aerie: quiesce, back up, build, migrate, bootstrap    |
| `deploy.ts`, `rollback.ts` | `bun run deploy` and `bun run rollback`                                       |
| `production-smoke.ts`      | Starts the built server on a temp catalog and runs the authentication smoke   |
| `provision-runtime.sh`     | Installs the Bun release named in `.bun-version` into Ongoing's own mise data |
| `config/*.plist.example`   | The two committed LaunchAgent definitions                                     |

## What the core keeps

The application's entry points live in `src/lib/host/`: `production-server.ts` is the HTTP
boundary, `build.ts` publishes immutable bundles, and `scan-command.ts` runs an explicit standalone
scan. The installed stable `scripts/scan.ts` entry point delegates to `scheduled-scan.ts`, an HTTP-only
client of the deployed service. Never repoint the calendar agent at the standalone scanner. See
[docs/deployment.md](../../docs/deployment.md).

## Running a machine without a profile

Nothing here is required to run Ongoing. A machine with no launchd and no profile does:

```sh
ongoing init
ongoing scan
ongoing serve
```

`ongoing init` writes `[host] adapter = "foreground"`. See [docs/deployment.md](../../docs/deployment.md).

## Fixed production target

- private repository: `git@github.com:marcus/ongoing.git` (`https://github.com/marcus/ongoing`)
- SSH host: `marcus@aerie.local`
- checkout: `/Users/marcus/code/ongoing`
- scan root: `/Users/marcus/code`
- database: `/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite`
- URL and health: `http://aerie.local:7766` and `http://127.0.0.1:7766/api/health`
- web agent: `com.marcusvorwaller.ongoing` at `~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`
- daily scan agent: `com.marcusvorwaller.ongoing.scan` at `~/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist`
- web logs: `~/Library/Logs/Ongoing/stdout.log` and `stderr.log`
- scan logs: `~/Library/Logs/Ongoing/scan-stdout.log` and `scan-stderr.log`
- app runtime: `/Users/marcus/.local/share/ongoing/bun` (a symlink into `/Users/marcus/.local/share/ongoing/mise/installs/bun/<version>/`)
- release record: `/Users/marcus/code/ongoing/.deploy/release.json`
- database backups: `/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite.backups/` (newest five)

Both agents use that one app-owned Bun executable. `.bun-version` is the only place the Bun version is written down: `deploy/aerie/provision-runtime.sh` installs that release with `/opt/homebrew/bin/mise` scoped to Ongoing's own data directory and points the stable executable at it, and the release worker re-runs provisioning whenever the checkout moves, so bumping Bun is editing `.bun-version`, running `bun install` to refresh `bun.lock`, and deploying. Provisioning does not install into, replace, or select Marcus's `~/.bun` runtime and does not change a global mise default. Release scripts reject different hosts, paths, labels, and health targets. They do not use `sudo`, modify the firewall/router, or touch unrelated services.

Both agents carry the collector PATH declared in `release-config.ts`, including mise shims and
Homebrew. Collection now happens in the web process, whose environment supplies tools, scan roots,
and the database path. Deployment checks the tools before stopping either agent, then atomically
installs the definitions and bootstraps the calendar job.

The web process runs `scripts/production-server.ts`, a stable shim onto the host boundary. It pins
one immutable adapter-node directory, bounds raw mutation bytes, and forwards to a private loopback
listener. `ONGOING_ENABLE_SCAN_SCHEDULER=false` disables startup and five-minute development scans.
The calendar invokes `scripts/scan.ts` at 03:00 with `ONGOING_URL` targeting this service. It never
opens the database itself. No `RunAtLoad` or `KeepAlive` means registering the calendar does not
trigger a scan. Manual and scheduled requests share the deployed scanner and durable scan lease.

## One-time setup

First verify that `https://github.com/marcus/ongoing` is private. Clone committed `main` only, then create the user-owned directories:

```sh
mkdir -p /Users/marcus/code
git clone --branch main --single-branch git@github.com:marcus/ongoing.git /Users/marcus/code/ongoing
mkdir -p '/Users/marcus/Library/Application Support/Ongoing' /Users/marcus/Library/Logs/Ongoing /Users/marcus/Library/LaunchAgents
cd /Users/marcus/code/ongoing
/bin/zsh deploy/aerie/provision-runtime.sh
```

Copy both committed definitions. Replace the placeholder in the web copy with a long random secret and restrict both machine-local files. Never print, log, or commit the secret.

```sh
cp deploy/aerie/config/ongoing.plist.example /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
cp deploy/aerie/config/ongoing-scan.plist.example /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
chmod 600 /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
```

After replacing the web secret, initialize through the exact app runtime:

```sh
ongoing_bun=/Users/marcus/.local/share/ongoing/bun
"$ongoing_bun" --version
"$ongoing_bun" install --frozen-lockfile
"$ongoing_bun" run build
DATABASE_PATH='/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' "$ongoing_bun" run scripts/migrate.ts
SCAN_ROOTS=/Users/marcus/code DATABASE_PATH='/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' "$ongoing_bun" run scripts/scan.ts
launchctl bootstrap gui/$(id -u) /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
launchctl bootstrap gui/$(id -u) /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
```

Bootstrapping the scan agent merely registers its next calendar event. The initial command above is an explicit one-shot scan. Plain LAN HTTP intentionally uses `SESSION_COOKIE_SECURE=false`; otherwise browsers discard the session cookie. Adapter-node's `ORIGIN` and the application's `APP_ORIGIN` both exactly match `http://aerie.local:7766`. A non-loopback `HOST` refuses to initialize without `ONGOING_ACCESS_SECRET`.

## Daily refresh behavior

`StartCalendarInterval` uses aerie's local timezone and requests Hour 3, Minute 0. When aerie is awake with Marcus's GUI domain active, launchd starts one scanner at 03:00. If the Mac is asleep at 03:00, launchd coalesces the missed event and runs it after wake. If the machine is powered off or the user LaunchAgent domain is unavailable, do not rely on catch-up across shutdown/logout; the next regular opportunity is 03:00 after the user domain is active. Run the documented manual scan if an immediate refresh is wanted after an extended outage.

Inspect definitions and live state without starting a scan:

```sh
plutil -lint deploy/aerie/config/ongoing.plist.example deploy/aerie/config/ongoing-scan.plist.example
env -i HOME=/Users/marcus PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/gh auth status
env -i HOME=/Users/marcus PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/td --version
env -i HOME=/Users/marcus PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /opt/homebrew/bin/cloc --version
env -i HOME=/Users/marcus PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/git --version
launchctl print gui/$(id -u)/com.marcusvorwaller.ongoing
launchctl print gui/$(id -u)/com.marcusvorwaller.ongoing.scan
tail -n 100 /Users/marcus/Library/Logs/Ongoing/scan-stderr.log
```

## Update

Preview every operation locally first:

```sh
bun run deploy --host marcus@aerie.local --checkout /Users/marcus/code/ongoing --database '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

Remove `--dry-run` only after review. The client provisions the app-scoped Bun from the current `.bun-version`, then invokes the remote worker with that absolute executable. The worker requires a clean checkout, records the prior SHA, fetches and fast-forwards `main`, re-provisions from the fetched `.bun-version`, quiesces both agents so neither serving nor a calendar scan can overlap backup/migration, takes a consistent SQLite backup, installs the frozen lockfile, builds, migrates once, and preserves the machine-local web secret while installing both committed definitions. It registers the scan calendar without running it, starts the web agent, waits 30 seconds for exact health on port 7766, retains five backups, and records the deployed SHA. Fix failed deployments in Git; never patch the production checkout by hand.

## Smoke and rollback

Keep the secret in the environment, not argv, URLs, logs, or the database:

```sh
ongoing_bun=/Users/marcus/.local/share/ongoing/bun
curl --fail --silent http://127.0.0.1:7766/api/health
ONGOING_ACCESS_SECRET='...' "$ongoing_bun" run scripts/smoke.ts http://aerie.local:7766
bun run rollback --host marcus@aerie.local --checkout /Users/marcus/code/ongoing --database '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

The loopback request above is the host-local minimal health probe. The authenticated smoke must use the configured `APP_ORIGIN` (`http://aerie.local:7766`); substituting the loopback origin intentionally fails the same-origin mutation checks with 403.

Remove `--dry-run` to quiesce both agents, take a new safety backup, rebuild the recorded prior SHA with the pinned runtime, restore both definitions, register the daily job without an unscheduled scan, restart the web process, and verify port 7766 health. Add `--restore-database` only for a non-backward-compatible migration; the database copy and WAL/SHM cleanup happen while both jobs are stopped. A healthy public response is exactly `{"ok":true}`; catalog and mutation endpoints require a valid session. Finish with the LAN smoke from a second machine and confirm both `launchctl print` targets and all four log files.

### Safe local builds and scheduled scans

The 03:00 agent runs `scripts/scan.ts` with `ONGOING_URL=http://127.0.0.1:7766`. It requests the
scan through the deployed service and waits for its result. It no longer opens the live database
from source. Its plist needs no database path or scan roots; those belong to the web agent.

Builds publish immutable artifacts under `.ongoing-builds/`; `ongoing restart --build` activates the
new bundle. For an existing directory-based installation, stop the service and adopt the old bundle as an immutable build before the first new build. See [the lifecycle and retention guidance](../../docs/deployment.md#build-and-activation-lifecycle).
