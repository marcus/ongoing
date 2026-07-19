# Private LAN deployment

Ongoing is designed for one trusted user on a private LAN. It is not hardened for public exposure. Do not add router forwarding, a public tunnel, or public DNS. Move to HTTPS before using it on a less-trusted network.

## Fixed production target

- SSH host: `marcus@aerie.local`
- checkout: `/Users/marcusvorwaller/code/ongoing`
- database: `/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite`
- URL: `http://aerie.local:4173`
- user LaunchAgent: `com.marcusvorwaller.ongoing`
- release record: `/Users/marcusvorwaller/code/ongoing/.deploy/release.json`
- database backups: `/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite.backups/` (newest five)

The scripts reject different targets. They do not use `sudo`, modify the firewall/router, or touch unrelated services.

## One-time setup

Clone the private repository at the checkout above and verify the remote is private. Copy `config/ongoing.plist.example` to `~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`, replace the placeholder with a long random secret, and restrict it with `chmod 600`. The plist is machine-local and must never be committed. Create the user-owned data and log directories, then use `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist` once.

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
