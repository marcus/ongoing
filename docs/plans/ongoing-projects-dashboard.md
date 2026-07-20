# Ongoing projects dashboard

## Summary

Build a small local web app that scans Git repositories under `~/code`, enriches them with local Git, TD, and GitHub data, and presents them as a sortable vertical list. The point is not just to inventory projects. The app should help answer a harder question: where would a few hours of attention have the most value?

The app will use SvelteKit and Svelte 5, run with Bun, and keep its own SQLite database. The filesystem remains the source of truth for which projects exist. TD supplies issue data for repositories that use TD, and GitHub supplies public interest and maintenance data for repositories with a GitHub remote.

This is a private, single-user application for the local network. Development may happen on different machines, but `aerie.local` is the canonical runtime and owns the production SQLite database. The app should stay easy to run, easy to inspect, and tolerant of repositories that are missing tools, remotes, commits, or credentials.

## Goals

- Discover Git repositories beneath one or more configured roots, initially `~/code`.
- Show projects in a dense vertical list that works well with roughly 100 repositories.
- Sort by recent activity, size, commits, TD work, GitHub interest, and maintenance pressure.
- Let the user switch to a manual order and rearrange projects with drag-and-drop or keyboard controls.
- Let the user locally star projects, add a short note, and hide projects without deleting their history.
- Collect enough history to show trends instead of static counters.
- Refresh cheaply when nothing has changed and degrade gracefully when GitHub, TD, or `cloc` is unavailable.
- Keep TD and GitHub behind adapters so neither external data model leaks into the core project model.
- Produce the same build on any development machine and deploy it predictably to `aerie.local`.

## Non-goals

- Editing TD issues from the dashboard in the first release.
- Replacing TD's monitor or GitHub's issue and pull-request interfaces.
- Exposing the app outside the LAN or supporting multiple users.
- Building a universal source-code analytics platform.
- Producing a single opaque score that claims to know which project matters most.
- Continuously watching every file beneath `~/code`.

## Architectural decisions

### The app owns its database

Store the project catalog in an app-owned SQLite file, such as `.data/ongoing.sqlite`. Do not add tables to `.todos/issues.db` and do not represent projects as TD issues.

TD's model is built around issues, workflow state, sessions, reviews, handoffs, and issue-linked Git snapshots. It has no arbitrary project metadata, and fields such as `points`, `labels`, and `updated_at` would be poor substitutes for LOC, project path, star count, or scan timestamps. Sharing TD's database file would also couple this app to TD migrations without gaining a supported API for the custom tables.

### Filesystem discovery is authoritative

A project exists when the scanner finds a valid Git repository. SQLite is an index and cache, not the authority. A project that disappears from disk is marked missing and retained until explicitly removed, preserving notes, manual order, favorites, and metric history.

### TD and GitHub are adapters

The application domain should expose interfaces such as `IssueMetricsProvider` and `HostingMetricsProvider`. The first implementations will be TD and GitHub, but the project model will not contain TD DTOs or raw GitHub responses.

### One local process

Use a modular SvelteKit application rather than separate frontend, API, and worker services. The scanner is a reusable server module with a CLI entry point. The web process can call it at startup, on a timer, and on demand.

## Technology

- Runtime and package manager: latest stable Bun at implementation time, pinned in project metadata and `bun.lock`.
- Framework: latest stable SvelteKit 2 and Svelte 5.
- Language: TypeScript with strict checking.
- Deployment adapter: `@sveltejs/adapter-node`, executed with Bun and verified with a production-build smoke test.
- Database: Bun's built-in `bun:sqlite` API.
- LOC collection: installed `cloc`, using Git-tracked files.
- Tests: Vitest for unit and integration tests; Playwright for a small browser smoke suite.
- Formatting and static checks: Prettier, ESLint, and `svelte-check`.

Development servers should bind to loopback by default. The production service on `aerie.local` should bind to its LAN interface on a fixed configurable port so other machines can reach it at `http://aerie.local:<port>`.

## Development and deployment topology

Code may be written and tested on any of Marcus's machines on the LAN. Source control is the handoff between those machines; no build output, `node_modules`, SQLite files, notes, credentials, or machine-specific configuration should be committed.

Before the first deployment, create a new private GitHub repository for this project and push `main` to it. Verify the repository's visibility is private before pushing any source. The exact repository name can be chosen at implementation time. Commit the Bun lockfile and an exact Bun version declaration so local development and `aerie.local` use the same toolchain.

`aerie.local` is the production host:

- SSH account: `marcus@aerie.local`.
- Application checkout: `~/code/<repo-name>`.
- Project scan root: `~/code` unless production configuration overrides it.
- Persistent application data: the checkout's ignored `.data/` directory or a configured path beneath Marcus's home directory.
- LAN URL: `http://aerie.local:7766`.
- Process manager: one user-level macOS LaunchAgent for the persistent web app and a distinct calendar LaunchAgent for the daily 04:00 refresh.

The application repository will itself appear beneath the scan root. It can remain visible as a project or be hidden through the normal UI.

### Implementing-agent authorization

The implementing agent has permission and working access to connect to the production machine with:

```sh
ssh marcus@aerie.local
```

When the application has passed its launch checks, the implementing agent should use that access to perform the first deployment. This authorization covers connecting over SSH, cloning the new private GitHub repository into `~/code/`, installing the locked application dependencies, building the app, applying its migrations, configuring and starting the user-level service, and running deployment verification. It does not authorize `sudo`, broad operating-system changes, opening the service to the public internet, or changing unrelated projects on `aerie.local`.

Do not copy an uncommitted working tree to the server. The commit on `aerie.local` must match the tested commit on `main` in the private GitHub repository.

### First-launch runbook

Once the application is ready to launch:

1. Run all required checks on the implementation machine and record the commit SHA being deployed.
2. Create the GitHub repository as private, add it as `origin`, push `main`, and verify its private visibility.
3. Run `ssh marcus@aerie.local` and verify the host identity, available disk space, Bun version, Git access to the private repository, and the availability of `git`, `td`, and `cloc`.
4. Create `~/code/` if needed and clone the private repository to `~/code/<repo-name>`.
5. Install the exact Bun version declared by the project if it is not already available. Install dependencies from the lockfile without updating them.
6. Create production configuration outside Git, including the scan root, database path, host, port, GitHub authentication mode, and any LAN access secret.
7. Build the production application, run database migrations, and perform a one-shot scan.
8. Install both user-level LaunchAgents with the app-scoped pinned Bun: a persistent web service on port 7766 and a calendar-only scanner at 04:00.
9. Verify the health endpoint locally on `aerie.local`, then open the app from a second LAN machine through `http://aerie.local:7766`.
10. Confirm that the catalog scans `~/code`, notes and ordering survive a restart, hidden projects remain hidden, TD enrichment works, and GitHub failures degrade cleanly.

If any verification fails, stop the new service, preserve its logs and database, and fix the issue through a new commit. Do not patch the production checkout by hand.

### Updates and rollback

Add a documented deployment command or script that performs this sequence over SSH:

1. Confirm the remote checkout is clean.
2. Record the currently deployed commit.
3. Fetch and fast-forward to the selected commit on `main`.
4. Quiesce both agents, back up the SQLite file, install from the lockfile, build, and apply migrations.
5. Restore both LaunchAgent definitions, schedule the scanner without running it immediately, and restart the web LaunchAgent.
6. Wait for the health check and run a LAN smoke test.

Rollback should check out the recorded prior commit, rebuild it, restore the pre-migration database backup when the migration is not backward-compatible, restart the service, and verify health. Keep a small fixed number of timestamped database backups rather than growing an unbounded archive.

## User experience

### Main list

Each project row should show:

- Local favorite star.
- Drag handle when manual ordering is active.
- Project name and path relative to the configured scan root.
- Brief editable note.
- Current branch and dirty state.
- Latest commit age and subject.
- Recent commit activity.
- LOC and dominant language.
- Open TD work.
- GitHub stars, star trend, open issues, and open pull requests when available.
- Compact warning indicators for stale data, failed collection, or a missing repository.
- An overflow menu containing Hide, Open in Finder, Open in terminal, and Open on GitHub when applicable.

Rows should remain compact. Secondary metrics can expand in a detail drawer rather than turning the list into a wide spreadsheet.

### Sorting

Support these initial sorts in both directions where meaningful:

- Manual order.
- Latest commit.
- Commits in the last 30 days.
- Active development days in the last 30 days.
- Lines of code.
- Lifetime commits.
- Open TD issues.
- GitHub stars.
- Stars gained in the last 30 days.
- Open GitHub pull requests.
- Age of the oldest external pull request.
- Recent GitHub traffic, when available.
- Project name.

Sort selection, direction, filters, and search should live in URL query parameters so browser navigation and bookmarks behave predictably. Project name is the final tie-breaker for every computed sort.

### Manual reordering

Manual ordering is a distinct sort mode. When it is selected:

- Show a drag handle on every visible row.
- Support pointer drag-and-drop.
- Provide keyboard alternatives: move up, move down, move to top, and move to bottom.
- Persist the result immediately in one database transaction.
- Append newly discovered projects to the bottom of the manual order.
- Preserve the rank of hidden projects so restoring one puts it back near its previous position.
- Do not modify manual ranks when another sort mode is active.

For the expected list size, integer positions are simpler than fractional ranking. A reorder can rewrite the visible sequence as `1000, 2000, 3000, ...` in a single transaction. This leaves gaps for inserting newly restored projects and avoids precision or lexical-ranking edge cases.

### Local stars

The star in this app means "favorite," not GitHub stars. Store it internally as `is_favorite` and label GitHub's metric explicitly as "GitHub stars."

Favoriting should be instantaneous and should not alter manual order. Add a Favorites filter and an optional "favorites first" grouping that can be combined with computed sorts.

### Notes

Each project can have one short plain-text note, initially limited to 500 characters. It should be editable inline, save on blur or after a short debounce, and show an explicit saved/error state. Notes are local and never written into a repository, TD, or GitHub.

Notes are intended for reminders such as "release after parser cleanup" or "interesting, but wait until autumn," not long-form project documentation.

### Hiding projects

The UI action should say Hide rather than Delete. Hiding a project:

- Removes it from the main list immediately.
- Preserves all metrics, history, notes, favorite state, and manual rank.
- Skips expensive LOC, TD, traffic, and GitHub enrichment during normal scans.
- Still performs cheap discovery so the app knows whether it remains on disk.

Provide a Manage hidden projects view where hidden entries can be searched, inspected, and restored. Restoring a project schedules an immediate enrichment scan.

Configuration-level ignore globs are separate from user-hidden projects. They are appropriate for directories that should never become catalog entries, such as archives, vendored repositories, or generated fixtures. Hidden projects remain in SQLite; ignored paths do not.

## Metrics

### Local Git metrics

Collect these for every repository with at least one commit:

- Current HEAD SHA and branch.
- Latest commit timestamp, subject, and short SHA.
- Lifetime reachable commit count.
- Commits in the last 7, 30, and 90 days.
- Active commit days in the last 30 and 90 days.
- Lines added and deleted in the last 30 and 90 days.
- Contributor count and the share of recent commits authored by the local user, where identity can be resolved.
- Dirty tracked-file count.
- Ahead/behind counts relative to the configured upstream.
- Latest reachable tag and commits since that tag.

Use argument arrays with `Bun.spawn`; never interpolate project paths into shell command strings. Empty repositories should return partial metrics rather than errors.

### Code metrics

Run `cloc --json --vcs git` and record:

- Source lines.
- Comment lines.
- Blank lines.
- File count.
- Dominant language.
- Test LOC when test files can be classified reliably.

The displayed LOC number means physical source lines in Git-tracked files. Re-run `cloc` only when HEAD or the tracked-working-tree fingerprint changes. Keep the last successful result if `cloc` fails.

### TD metrics

For repositories containing `.todos/issues.db`, collect:

- Open.
- In progress.
- Blocked.
- In review.
- Total non-closed issues.
- Stale non-closed issues with no update for 30 days.

If `.todos/serve-port` points to a healthy local TD server, prefer `/v1/stats` and issue queries through HTTP. Otherwise invoke the installed CLI with `--work-dir`. Count queries must use `--limit 0` to avoid TD's default result limit.

TD failures are per-project enrichment failures. They must not fail the overall scan.

### GitHub metrics

Identify GitHub repositories by parsing the `origin` remote in SSH and HTTPS forms. Record the GitHub repository node ID after the first successful lookup so remote URL changes do not break history.

Initial GitHub metrics:

- Visibility and archived state.
- GitHub star count.
- Fork count.
- Watcher/subscriber count when available.
- Open issues, excluding pull requests.
- Open pull requests, split into draft, ready, authored by the owner, and external.
- Age of the oldest open external pull request.
- Pull requests merged in the last 30 and 90 days.
- External issues opened in the last 30 and 90 days.
- Latest release timestamp and tag.
- Release download count where available.
- Default-branch workflow status.
- Contributor count.

Use GraphQL to batch inexpensive repository counters and connections. Use REST for traffic, workflow runs, and release assets where it is clearer or required. Cache responses and honor rate-limit headers.

GitHub traffic is available only for repositories where the authenticated account has sufficient access and only covers a short rolling window. Collect views, unique visitors, clones, and unique cloners daily so the application can retain its own history. Missing permission should produce `unavailable`, not an error banner on every row.

Current local `gh` credentials are invalid. GitHub enrichment therefore has a setup prerequisite: authenticate with `gh auth login` or provide a valid token with only the permissions required for the selected metrics. The app should detect and explain this state without blocking local and TD scanning.

### Manual decision data

Reserve fields for later decision-oriented features:

- Intent: invest, maintain, experiment, hibernate, or archive.
- Excitement: 1-5.
- Strategic importance: 1-5.
- Next action.
- Review-after date.

Only the note and favorite are required for the first release. The schema can include the other fields without putting unfinished controls in the main UI.

## Database design

Use versioned SQL migrations from the first commit. A practical initial schema is:

```sql
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    canonical_path TEXT NOT NULL UNIQUE,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    scan_root TEXT NOT NULL,

    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_hidden INTEGER NOT NULL DEFAULT 0,
    manual_rank INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',

    intent TEXT,
    excitement INTEGER,
    strategic_importance INTEGER,
    next_action TEXT,
    review_after TEXT,

    is_missing INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE project_metrics (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    head_sha TEXT,
    branch TEXT,
    latest_commit_at TEXT,
    latest_commit_subject TEXT,
    commit_count INTEGER,
    commits_30d INTEGER,
    active_days_30d INTEGER,
    churn_added_30d INTEGER,
    churn_deleted_30d INTEGER,
    dirty_files INTEGER,
    ahead_count INTEGER,
    behind_count INTEGER,
    loc_code INTEGER,
    loc_comment INTEGER,
    loc_blank INTEGER,
    dominant_language TEXT,
    td_open_count INTEGER,
    td_blocked_count INTEGER,
    td_review_count INTEGER,
    github_repo_id TEXT,
    github_owner TEXT,
    github_name TEXT,
    github_stars INTEGER,
    github_forks INTEGER,
    github_open_issues INTEGER,
    github_open_prs INTEGER,
    github_external_prs INTEGER,
    github_oldest_external_pr_at TEXT,
    github_latest_release_at TEXT,
    github_ci_state TEXT,
    git_scanned_at TEXT,
    loc_scanned_at TEXT,
    td_scanned_at TEXT,
    github_scanned_at TEXT
);

CREATE TABLE metric_snapshots (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    captured_on TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (project_id, metric, captured_on)
);

CREATE TABLE collection_errors (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    collector TEXT NOT NULL,
    message TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    resolved_at TEXT,
    PRIMARY KEY (project_id, collector)
);

CREATE TABLE scan_runs (
    id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    discovered_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0
);
```

Daily snapshots are enough for stars, LOC, traffic, open issues, and open pull requests. Do not snapshot fields that are not used for trends.

Enable foreign keys and WAL mode. Keep writes serialized inside the process, use short transactions, and use a scan lock so a manual scan cannot overlap a scheduled scan.

## Scanning and refresh behavior

### Discovery

1. Read configured scan roots and ignore globs.
2. Walk to a configurable maximum depth without following directory symlinks by default.
3. Detect both `.git` directories and `.git` files used by worktrees.
4. Resolve each candidate with `git rev-parse --show-toplevel`.
5. Canonicalize and deduplicate paths.
6. Upsert newly discovered projects and mark unseen projects missing after the scan completes.

The scanner should prune known expensive directories such as `node_modules`, `.cache`, build outputs, and package-manager stores before descending.

### Refresh schedule

Development keeps the in-process scheduler enabled: it starts a deferred scan after the first private request and requests a cheap refresh every five minutes while the development server is running. This preserves fast feedback without delaying the first page, which renders from the durable cache.

Production uses a separate lifecycle. The web LaunchAgent sets `ONGOING_ENABLE_SCAN_SCHEDULER=false`, so the serving process creates no startup or five-minute scan timers. The distinct `com.marcusvorwaller.ongoing.scan` user LaunchAgent invokes the shared `scripts/scan.ts` scanner once daily at 04:00 local time against the same `SCAN_ROOTS` and `DATABASE_PATH`. It uses one `StartCalendarInterval` entry and has neither `RunAtLoad` nor `KeepAlive`, so registering or restarting it does not trigger an unscheduled scan.

For both environments:

- Refresh GitHub counters when their 30-minute freshness window has expired.
- Refresh traffic when its daily freshness window has expired.
- Refresh LOC only when its fingerprint changes.
- Let the user request a full or per-project refresh at any time; these actions remain independent of the automatic production schedule.
- Use the durable scan lease to prevent manual, per-project, development-timer, and calendar scans from overlapping.

The canonical `bun run scan` command runs the same scanner outside the web request lifecycle and is the command used by the production calendar LaunchAgent.

### Concurrency and failure handling

- Begin with six concurrent repositories for Git and TD work.
- Limit `cloc` to two concurrent processes.
- Use one batched GitHub request where practical.
- Give local subprocesses explicit timeouts and terminate their process groups on timeout.
- Commit successful collector results independently. One failed collector must not discard other fresh metrics.
- Display stale cached values with their last-updated time.

## Application structure

```text
src/
  lib/
    domain/
      project.ts
      metrics.ts
      sorting.ts
    server/
      catalog/
        database.ts
        migrations.ts
        repository.ts
      collectors/
        discover.ts
        git.ts
        loc.ts
        td.ts
        github.ts
      scanning/
        scanner.ts
        scheduler.ts
        progress.ts
  routes/
    +page.server.ts
    +page.svelte
    api/
      projects/[id]/+server.ts
      projects/[id]/favorite/+server.ts
      projects/[id]/hide/+server.ts
      projects/reorder/+server.ts
      scan/+server.ts
      scan/events/+server.ts
    hidden/
      +page.server.ts
      +page.svelte
scripts/
  scan.ts
tests/
  fixtures/
  integration/
docs/
  adr/
  plans/
```

Keep sorting and decision calculations as pure functions. Put filesystem, subprocess, SQLite, TD, and GitHub code under server-only modules.

## Server contract

The initial internal HTTP surface can stay small:

- `GET /api/projects` returns the current catalog and metric freshness.
- `PATCH /api/projects/:id` updates note and later manual decision fields.
- `POST /api/projects/:id/favorite` toggles the local favorite.
- `POST /api/projects/:id/hide` hides or restores a project.
- `POST /api/projects/reorder` accepts the complete visible project ID sequence and validates that it contains no duplicates or unknown IDs.
- `POST /api/scan` starts a scan if none is running.
- `GET /api/scan/events` streams scan progress with SSE.

Use SvelteKit form actions where progressive enhancement improves the UI, but retain explicit endpoints for reorder and scan progress. Validate all project IDs against the database. Never accept an arbitrary filesystem path from a browser request.

## Decision-oriented views

Static metrics are useful, but the dashboard should eventually expose a few transparent views:

- Needs attention: failing CI, old external pull requests, blocked TD work, or stale issues.
- Rising: increasing stars, clones, traffic, or external participation.
- Opportunity: external interest with little recent development.
- Momentum: recent active days, commits, releases, and merged pull requests.
- Quick wins: relatively small projects with visible demand or a small actionable backlog.
- Dormant: little activity, little demand, and no explicit invest intent.

Do not ship a grand priority score in the first version. Once several weeks of snapshots exist, add separate Momentum, Demand, Attention, and Personal Priority scores. Every score should show its inputs and weights.

## Security and privacy

- Bind development servers to `127.0.0.1` by default. Bind the production service to the LAN on `aerie.local` only through explicit production configuration.
- Require a simple shared access secret for the non-loopback production listener and keep it outside Git. Use an HTTP-only session cookie after login rather than putting the secret in URLs.
- Restrict the production port to the LAN with the host firewall. Do not configure router port forwarding, public DNS, or a public tunnel.
- Plain HTTP is acceptable for the first release only on Marcus's trusted LAN. If the service becomes available on any less-trusted network, add HTTPS before using it there.
- Store no GitHub tokens in SQLite. Let `gh` or environment-based credential handling own them.
- Invoke subprocesses without a shell and validate every path remains beneath a configured scan root.
- Avoid following symlinks outside scan roots.
- Use parameterized SQL exclusively.
- Exclude `.data/`, `.env`, and other local state from Git.
- Keep notes private by default; they belong in the local database, not metric logs.

## Testing strategy

### Unit tests

- Sort comparators, including null values and stable name tie-breaking.
- Manual reorder validation and rank assignment.
- Favorite, note, hide, and restore state transitions.
- GitHub remote parsing for SSH and HTTPS forms.
- Parsers for Git, `cloc`, TD, and GitHub responses.
- Scan fingerprint and refresh scheduling rules.
- Ignore glob matching and scan-root containment.

### Integration tests

Create temporary repositories to cover:

- A normal repository with commits and tags.
- An empty repository.
- A dirty worktree.
- A linked Git worktree.
- A path containing spaces and Unicode.
- A project with TD data.
- Fake TD success, timeout, malformed output, and missing database cases.
- Fake GitHub success, rate limiting, invalid credentials, and partial permissions.
- SQLite migrations from an empty database and from every prior schema fixture.
- Concurrent manual and scheduled scan attempts.

### Browser tests

Keep Playwright coverage focused on the important flows:

1. Load the cached list and change sort order.
2. Switch to manual mode and reorder with pointer and keyboard controls.
3. Favorite a project and filter to favorites.
4. Add and persist a note.
5. Hide a project, confirm it leaves the main list, then restore it from the hidden view.
6. Trigger a scan and observe progress without losing the current list state.

### Deployment tests

- Build and run the production adapter with the pinned Bun version.
- Verify an unauthenticated LAN request is rejected and a valid session can reach the app.
- Verify the health endpoint without exposing repository data.
- Restart the LaunchAgent and confirm the app returns with the same SQLite state.
- Run the deployment script in a dry-run mode that performs no remote mutations.
- After first launch, run a smoke test from a second LAN machine against `http://aerie.local:7766`.

## Implementation phases

### Phase 1: foundation

- Scaffold SvelteKit with Bun while preserving `.todos` and this plan.
- Add formatting, linting, type checking, Vitest, and Playwright.
- Add `.gitignore`, local configuration example, and run commands.
- Implement SQLite connection, migrations, and repository layer.
- Write ADRs for app-owned storage, adapter boundaries, and scanning strategy.

Exit criteria: the app builds, opens an empty database, applies migrations, and passes its initial checks.

### Phase 2: local catalog

- Implement discovery and ignore globs.
- Implement Git and `cloc` collectors.
- Add cached project loading and refresh progress.
- Render the vertical list with local metrics and freshness states.

Exit criteria: eligible projects under `~/code` appear and can be sorted by activity, LOC, commits, and name. A broken repository does not break the scan.

### Phase 3: personal organization

- Implement local favorites.
- Implement inline notes.
- Implement hide, hidden-project management, and restore.
- Implement manual ordering with pointer and keyboard controls.
- Persist URL-backed sorts and filters.

Exit criteria: all four personal controls survive reloads and scans, and hidden projects retain their history and rank.

### Phase 4: TD enrichment

- Add HTTP-first, CLI-fallback TD collection.
- Display open, blocked, and in-review counts.
- Add stale-data and per-project failure handling.

Exit criteria: TD data arrives asynchronously and never blocks or fails the main catalog.

### Phase 5: GitHub enrichment

- Add GitHub authentication diagnostics and remote mapping.
- Batch public repository metrics.
- Add issue, pull-request, release, and workflow metrics.
- Add daily traffic collection where permissions allow.
- Store trend snapshots and expose star/traffic deltas.

Exit criteria: authenticated GitHub repositories show current counters and trends; unauthenticated or non-GitHub projects remain fully usable.

### Phase 6: attention views

- Add Needs attention, Rising, Opportunity, Momentum, Quick wins, and Dormant views.
- Add manual intent and personal-priority fields if the basic dashboard is proving useful.
- Tune refresh intervals and concurrency using observed scan timings.

Exit criteria: every derived view explains why a project appears and links back to the underlying metrics.

### Phase 7: private repository and `aerie.local` launch

- Create the new private GitHub repository and verify its visibility.
- Push the tested `main` branch.
- Add production configuration documentation and the SSH deployment/update script.
- Use the authorized `ssh marcus@aerie.local` access to clone the repository under `~/code/`.
- Install locked dependencies, build, migrate, scan, and configure the web and daily-scan LaunchAgents.
- Verify authentication, health, persistence, restart behavior, and LAN access from another machine.
- Document the deployed commit, service controls, log location, data location, update command, and rollback command.

Exit criteria: `aerie.local` serves the tested commit on the LAN, restarts cleanly, retains application state, and can be updated or rolled back without editing production files by hand.

## Definition of done for the first release

- The app discovers and displays the eligible repositories under `~/code`.
- The default order is latest commit first.
- Manual ordering works with a mouse and keyboard and persists across reloads.
- Local favorites, brief notes, hide, and restore all persist.
- Hidden projects do not appear in the main list and do not consume expensive scan work.
- Sorting works for activity, LOC, commits, TD issues, GitHub stars, pull requests, and name when those metrics are available.
- TD and GitHub enrichment is asynchronous and failure-isolated.
- New repositories appear automatically; missing repositories are marked rather than silently deleted.
- Repeated scans avoid unnecessary LOC and remote API work.
- Development binds to loopback; production is reachable only on the LAN at `aerie.local` and requires the configured access secret.
- The source is stored in a verified private GitHub repository.
- The tested commit is cloned under `~/code/` on `aerie.local` and runs as a user-level persistent service.
- Restart, update, database-backup, health-check, and rollback procedures are documented and verified.
- The app does not execute shell-interpolated paths.
- Unit, integration, browser smoke, type, lint, and production-build checks pass under the pinned Bun version.

## Open questions to resolve during implementation

- Whether the first release should scan only direct children and one nested level, or use a configurable default depth of three.
- Whether hidden projects should continue receiving cheap Git metrics or discovery-only updates. This plan recommends discovery only.
- Whether GitHub traffic is useful enough to justify the additional permissions after a few weeks of basic metric collection.
- Whether opening projects in an editor belongs in the first release or should wait until the list and attention views are stable.
