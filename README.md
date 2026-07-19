# ongoing

A private, single-user dashboard for deciding which local software projects deserve attention. Ongoing discovers Git repositories, caches local and provider metrics in an app-owned SQLite catalog, and presents them using the interaction and visual direction in `docs/mockups/dashboard.html`.

The repository currently contains the Bun and SvelteKit application foundation. Catalog and scanner implementation follows in later stories.

## Local setup

1. Install Bun `1.3.1` (the exact version in `.bun-version`).
2. Run `bun install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and adjust the local paths if needed.
4. Run `bun run dev` and open `http://127.0.0.1:5173`.

Development and preview bind to loopback by default. Production may set `HOST` and `PORT` explicitly when the service is intentionally exposed on the private LAN.

## Commands

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `bun run dev`          | Start the loopback-only development server                |
| `bun run build`        | Build the adapter-node production application             |
| `bun run preview`      | Preview the build on loopback                             |
| `bun run check`        | Generate SvelteKit types and run `svelte-check`           |
| `bun run lint`         | Run ESLint and verify formatting                          |
| `bun run format`       | Format source and documentation                           |
| `bun run format:check` | Verify formatting only                                    |
| `bun run test`         | Run the Vitest suite                                      |
| `bun run test:e2e`     | Run Playwright browser tests                              |
| `bun run scan`         | Run the scanner CLI (placeholder until the catalog story) |

## Architecture

The full product plan lives in `docs/plans/ongoing-projects-dashboard.md`. The initial architectural constraints are recorded in `docs/adr/`: app-owned storage, provider boundaries, and cache-first bounded scanning.
