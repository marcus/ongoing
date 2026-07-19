# Private LAN deployment

Ongoing is designed for one trusted user on a private LAN. It is not hardened for public exposure. Do not add router forwarding, a public tunnel, or public DNS. Move to HTTPS before using it on a less-trusted network.

## Fixed production target

- private repository: `git@github.com:marcus/ongoing.git` (`https://github.com/marcus/ongoing`)
- SSH host: `marcus@aerie.local`
- checkout: `/Users/marcusvorwaller/code/ongoing`
- scan root: `/Users/marcusvorwaller/code`
- database: `/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite`
- URL: `http://aerie.local:4173`
- user LaunchAgent: `com.marcusvorwaller.ongoing`
- LaunchAgent configuration: `/Users/marcusvorwaller/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`
- stdout log: `/Users/marcusvorwaller/Library/Logs/Ongoing/stdout.log`
- stderr log: `/Users/marcusvorwaller/Library/Logs/Ongoing/stderr.log`
- release record: `/Users/marcusvorwaller/code/ongoing/.deploy/release.json`
- database backups: `/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite.backups/` (newest five)

The scripts reject different targets. They do not use `sudo`, modify the firewall/router, or touch unrelated services.

## One-time setup

First verify that `https://github.com/marcus/ongoing` is private. Clone committed `main` only, then create the user-owned runtime directories:

```sh
mkdir -p /Users/marcusvorwaller/code
git clone --branch main --single-branch git@github.com:marcus/ongoing.git /Users/marcusvorwaller/code/ongoing
mkdir -p '/Users/marcusvorwaller/Library/Application Support/Ongoing' /Users/marcusvorwaller/Library/Logs/Ongoing /Users/marcusvorwaller/Library/LaunchAgents
```

Copy `config/ongoing.plist.example` to `/Users/marcusvorwaller/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`, replace the placeholder with a long random secret, and restrict it with `chmod 600`. The plist is the production environment/configuration and contains the secret; it is machine-local and must never be printed, logged, or committed. Install the exact Bun version from `.bun-version`, then initialize the committed checkout:

```sh
cd /Users/marcusvorwaller/code/ongoing
bun install --frozen-lockfile
bun run build
DATABASE_PATH='/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite' bun run migrate
SCAN_ROOTS=/Users/marcusvorwaller/code DATABASE_PATH='/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite' bun run scan
launchctl bootstrap gui/$(id -u) /Users/marcusvorwaller/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
```

Plain LAN HTTP intentionally uses `SESSION_COOKIE_SECURE=false`; otherwise browsers will discard the session cookie. The cookie remains HTTP-only and SameSite Strict. Adapter-node's `ORIGIN` and the application's `APP_ORIGIN` must both exactly match the browser origin. `BODY_SIZE_LIMIT=16384` matches the application request cap. A non-loopback `HOST` refuses to initialize without `ONGOING_ACCESS_SECRET`.

## Update

Preview every operation locally first:

```sh
bun run deploy --host marcus@aerie.local --checkout /Users/marcusvorwaller/code/ongoing --database '/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

Remove `--dry-run` to deploy. The remote worker requires a clean checkout, switches to `main`, fetches and fast-forwards only, takes a consistent SQLite backup, retains five, installs from `bun.lock`, builds, migrates, restarts only the user LaunchAgent, waits 30 seconds for minimal health, and records prior/deployed SHAs. Fix failed deployments in Git; never patch production files by hand.

## Smoke and rollback

Keep the secret in the environment, not argv, URLs, logs, or the database:

```sh
ONGOING_ACCESS_SECRET='...' bun run smoke http://aerie.local:4173
bun run rollback --host marcus@aerie.local --checkout /Users/marcusvorwaller/code/ongoing --database '/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite' --dry-run
```

Remove `--dry-run` to rebuild and restart the recorded prior SHA. Add `--restore-database` only when reverting a non-backward-compatible migration; it stops the user service before copying the recorded pre-deploy snapshot. Rollback first takes a new safety backup and records the resulting state.

Inspect with `launchctl print gui/$(id -u)/com.marcusvorwaller.ongoing` and the two files under `~/Library/Logs/Ongoing/`. A healthy public response is exactly `{"ok":true}`; catalog and mutations require a valid session.
