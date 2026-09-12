# Authentication

The dashboard supports a single shared **access secret** login (an HMAC-signed
session cookie). For a local-network-only deployment this is optional and is
currently **disabled**.

## Current state: auth bypassed

Login is bypassed via the `ONGOING_DISABLE_AUTH` environment variable. When set
to `true`, `loadConfig` forces `authenticationRequired = false`, so
`hasValidSession` always returns `true` and every route loads without a login
prompt. The access-secret code paths remain in place — nothing was deleted.

It is set in the installed launchd plist:

```xml
<key>ONGOING_DISABLE_AUTH</key><string>true</string>
```

- Installed plist: `~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`
- Template: `deploy/aerie/config/ongoing.plist.example`

## How it works

`src/lib/server/config.ts` — `loadConfig()`:

```ts
const authDisabled = env.ONGOING_DISABLE_AUTH === 'true';
const authenticationRequired =
  !authDisabled && (!isLoopbackHost(host) || env.ONGOING_REQUIRE_AUTH === 'true');
```

With `authDisabled` true, `authenticationRequired` is false regardless of `HOST`
(the server binds `0.0.0.0`), and the `ONGOING_ACCESS_SECRET` requirement check
is skipped. The gate itself lives in `src/hooks.server.ts` (routes through
`hasValidSession`).

`hooks.server.ts` also skips the same-origin mutation check
(`isSameOriginMutation`) when `authenticationRequired` is false. That check
compares the request's `Origin` header against the configured `APP_ORIGIN`
(e.g. `http://aerie.local:7766`), so it 403s any mutating request made from a
different hostname on the LAN (e.g. `http://localhost:7766` or a raw IP). Since
`ONGOING_DISABLE_AUTH` already opens every route to anyone on the network, this
CSRF check adds no protection while it's set, and was blocking legitimate
requests like the favorites toggle.

## Re-enabling auth later

1. In `~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist`, remove the
   `ONGOING_DISABLE_AUTH` key (or set it to `false`).
2. Ensure `ONGOING_ACCESS_SECRET` is a long random string (≥16 chars). Generate
   one and paste it in:
   ```sh
   openssl rand -hex 32
   ```
3. Reload the agent:
   ```sh
   launchctl bootout gui/$(id -u)/com.marcusvorwaller.ongoing
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist
   ```
4. Visit the site and log in at `/login` with that secret.

Precedence: `ONGOING_DISABLE_AUTH=true` overrides `ONGOING_REQUIRE_AUTH=true`.
