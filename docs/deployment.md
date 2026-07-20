# Private LAN deployment

Ongoing is designed for one trusted user on a private LAN. It is not hardened for public exposure. Do not add router forwarding, a public tunnel, or public DNS. Move to HTTPS before using it on a less-trusted network.

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
- app runtime: `/Users/marcus/.local/share/ongoing/mise/installs/bun/1.3.1/bin/bun`
- release record: `/Users/marcus/code/ongoing/.deploy/release.json`
- database backups: `/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite.backups/` (newest five)

Both agents use that one app-owned Bun executable, which must report the exact version in `.bun-version`. Provisioning scopes `/opt/homebrew/bin/mise` to Ongoing's own data directory; it does not install into, replace, or select Marcus's `~/.bun` runtime and does not change a global mise default. Release scripts reject different hosts, paths, labels, runtime versions, and health targets. They do not use `sudo`, modify the firewall/router, or touch unrelated services.

The web process has `ONGOING_ENABLE_SCAN_SCHEDULER=false`, so it creates neither the development startup scan nor the five-minute interval. The scan agent invokes the shared `scripts/scan.ts` once at 04:00 local time against the same database and scan root. Its definition has no `RunAtLoad` or `KeepAlive`; registering or restarting it does not cause an immediate scan. A manual or per-project scan remains available, and the durable scan lease prevents overlap.

## One-time setup

First verify that `https://github.com/marcus/ongoing` is private. Clone committed `main` only, then create the user-owned directories:

```sh
mkdir -p /Users/marcus/code
git clone --branch main --single-branch git@github.com:marcus/ongoing.git /Users/marcus/code/ongoing
mkdir -p '/Users/marcus/Library/Application Support/Ongoing' /Users/marcus/Library/Logs/Ongoing /Users/marcus/Library/LaunchAgents
cd /Users/marcus/code/ongoing
/bin/zsh scripts/provision-runtime.sh
```

Copy both committed definitions. Replace the placeholder in the web copy with a long random secret and restrict both machine-local files. Never print, log, or commit the secret.

```sh
cp config/ongoing.plist.example /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
cp config/ongoing-scan.plist.example /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
chmod 600 /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
```

After replacing the web secret, initialize through the exact app runtime:

```sh
ongoing_bun=/Users/marcus/.local/share/ongoing/mise/installs/bun/1.3.1/bin/bun
"$ongoing_bun" --version
"$ongoing_bun" install --frozen-lockfile
"$ongoing_bun" run build
DATABASE_PATH='/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' "$ongoing_bun" run migrate
SCAN_ROOTS=/Users/marcus/code DATABASE_PATH='/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' "$ongoing_bun" run scan
launchctl bootstrap gui/$(id -u) /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist
launchctl bootstrap gui/$(id -u) /Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
```

Bootstrapping the scan agent merely registers its next calendar event. The initial command above is an explicit one-shot scan. Plain LAN HTTP intentionally uses `SESSION_COOKIE_SECURE=false`; otherwise browsers discard the session cookie. Adapter-node's `ORIGIN` and the application's `APP_ORIGIN` both exactly match `http://aerie.local:7766`. A non-loopback `HOST` refuses to initialize without `ONGOING_ACCESS_SECRET`.

## Daily refresh behavior

`StartCalendarInterval` uses aerie's local timezone and requests Hour 4, Minute 0. When aerie is awake with Marcus's GUI domain active, launchd starts one scanner at 04:00. If the Mac is asleep at 04:00, launchd coalesces the missed event and runs it after wake. If the machine is powered off or the user LaunchAgent domain is unavailable, do not rely on catch-up across shutdown/logout; the next regular opportunity is 04:00 after the user domain is active. Run the documented manual scan if an immediate refresh is wanted after an extended outage.

Inspect definitions and live state without starting a scan:

```sh
plutil -lint config/ongoing.plist.example config/ongoing-scan.plist.example
launchctl print gui/$(id -u)/com.marcusvorwaller.ongoing
launchctl print gui/$(id -u)/com.marcusvorwaller.ongoing.scan
tail -n 100 /Users/marcus/Library/Logs/Ongoing/scan-stderr.log
```

## Update

Preview every operation locally first:

```sh
bun run deploy --host marcus@aerie.local --checkout /Users/marcus/code/ongoing --database '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

Remove `--dry-run` only after review. The client provisions and validates app-scoped Bun 1.3.1, then invokes the remote worker with that absolute executable. The worker requires a clean checkout, records the prior SHA, fetches and fast-forwards `main`, revalidates the pin, quiesces both agents so neither serving nor a calendar scan can overlap backup/migration, takes a consistent SQLite backup, installs the frozen lockfile, builds, migrates once, and preserves the machine-local web secret while installing both committed definitions. It registers the scan calendar without running it, starts the web agent, waits 30 seconds for exact health on port 7766, retains five backups, and records the deployed SHA. Fix failed deployments in Git; never patch the production checkout by hand.

## Smoke and rollback

Keep the secret in the environment, not argv, URLs, logs, or the database:

```sh
ONGOING_ACCESS_SECRET='...' bun run smoke http://aerie.local:7766
bun run rollback --host marcus@aerie.local --checkout /Users/marcus/code/ongoing --database '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

Remove `--dry-run` to quiesce both agents, take a new safety backup, rebuild the recorded prior SHA with the pinned runtime, restore both definitions, register the daily job without an unscheduled scan, restart the web process, and verify port 7766 health. Add `--restore-database` only for a non-backward-compatible migration; the database copy and WAL/SHM cleanup happen while both jobs are stopped. A healthy public response is exactly `{"ok":true}`; catalog and mutation endpoints require a valid session. Finish with the LAN smoke from a second machine and confirm both `launchctl print` targets and all four log files.
