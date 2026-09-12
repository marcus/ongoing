# AGENTS.md

Read and apply the **project-standards** skill before working here. On this machine it lives at
[`~/.codex/skills/project-standards/SKILL.md`](/Users/marcus/.codex/skills/project-standards/SKILL.md);
resolve it by skill name on other installations. It owns the shared engineering, workflow, and
architecture conventions. This file covers Ongoing-specific guidance.

## Operate the app

`bin/ongoing` (usually `ongoing` on PATH) is the quickest inspection surface:
`ongoing status`, `ongoing list --json`, `ongoing show <project>`, `ongoing providers`,
`ongoing scan --wait`, and `ongoing logs -f`. See [docs/cli.md](docs/cli.md).

The CLI uses the same HTTP contract as the browser. With no service, automatic transport opens the
shared library locally; `--remote` or `--transport http` forbids that fallback. Scheduled scans use
`scripts/scan.ts`, which always requests and waits for a scan over HTTP. Never point a production
calendar job at `scan-command.ts`, `bun run scan`, or a CLI invocation that can fall back locally:
opening the catalog from newer source can migrate it ahead of the deployed server.

`bun run build` writes an immutable directory under `.ongoing-builds/`, then publishes the `build`
symlink. The running server pins its directory, so ordinary builds leave routes and assets usable.
`ongoing restart --build` builds and activates it through the host adapter. A failed build leaves
the previous build selected. Never delete `.ongoing-builds/` while a service is running; see
[docs/deployment.md](docs/deployment.md) for retention and upgrading an old installation.

Production is the launchd agent `com.marcusvorwaller.ongoing`, serving
`http://aerie.local:7766` and `http://localhost:7766`. The separate `.scan` agent triggers at 03:00.
Machine-specific paths, plists, and release operations belong in [deploy/aerie/](deploy/aerie/README.md).
Logs are in `~/Library/Logs/Ongoing/`. Restarting uses bootout/bootstrap so plist changes reload.

**Auth is deliberately disabled** in this local-network deployment with `ONGOING_DISABLE_AUTH=true`.
Do not re-enable it without being asked. The same-origin mutation check is also intentionally skipped
when authentication is off. See [docs/auth.md](docs/auth.md). Preserve production data and never stop,
restart, or replace the default tmux server; tests requiring tmux must use an isolated socket.

## Architecture rules

- The catalog is `entries`, `entry_sources`, `fields`, `relations`, and `saved_views`. Register a field
  for per-entry values; do not add a column or recreate a projects/technologies table. Entry paths may
  be absent for remote-only repositories. `validateEntryPatch` is the write validation boundary.
- All reads use the grammar in `src/lib/domain/query.ts`. `/api/entries`, `ongoing list`, and browser
  URL parameters share it. Add a clause or field instead of another list parameter. Built-in saved
  views live in `src/lib/domain/view.ts`; completeness counts registry fields marked `required`.
- Add owned capabilities in order: domain function, repository, API, CLI, then UI. The local API
  transport in `src/lib/server/api/local.ts` calls the same library; keep it aligned with HTTP.
- Providers declare their fields, relations, requirements, dependencies, and schedules in
  `src/lib/domain/provider.ts`. The scanner runs active providers in dependency order. Disabled or
  unavailable providers register no fields; failures record a reason without failing the scan.
- Technologies are entries; usages are `uses` relations. Seeds and signatures live in
  `src/lib/domain/technology.ts`. Detected edges belong to `tech-signatures` and are replaced on
  scans; declared edges survive. Regenerate project-standards tables after catalog changes with
  `scripts/render-project-standards.ts`.
- Configuration is `~/.config/ongoing/config.toml`, read by `loadRuntimeConfig`, with environment
  overrides. Keep `loadConfig(env, file)` pure. Supervision belongs in `src/lib/host/`; core code
  must never import deployment profiles.

See [README.md](README.md), [ADRs](docs/adr/), and the
[implemented inventory design](docs/plans/implemented/ongoing-inventory-redesign.md) for rationale.

## UI and architecture evidence

Read [DESIGN.md](DESIGN.md) before UI work. Use `src/lib/ui/tokens.css` for every colour, size,
weight, and duration; no component colour literals or pixel font sizes. The inventory shell lives
under `src/routes/(inventory)/`; filtering and sorting run locally over the loaded catalog.
Optimistic edits use `src/lib/domain/optimistic.ts` and support undo. Browser mutation coverage in
`tests/e2e/inventory.test.ts` also exercises the matching CLI operations.

Update `docs/diagrams/fractal/` when responsibilities, boundaries, or journeys change. Preserve stable
UIDs, cite touched source files, and use the Fractal skill at `~/code/fractal/skills/fractal/SKILL.md`.
Validate with `fractal validate --directory "$PWD/docs/diagrams/fractal" --json` (absolute path), then
re-export affected scenes. UI screenshots live in `docs/qa/screens/`; regenerate with
`QA_SCREENSHOTS=1 E2E_PORT=7801 bun run test:e2e tests/e2e/screenshots.test.ts`.

## Finish

Run `bun run lint`, `bun run test`, and `bun run check`, plus focused journey coverage. Report any
blocked check explicitly. Commit and push completed work to `main` unless told otherwise; preserve
unrelated work. Build alone does not deploy changes: restart and verify actual dashboard routes when
changing production behavior.
