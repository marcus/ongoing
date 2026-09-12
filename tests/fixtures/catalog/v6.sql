-- Schema as of migration 006, dumped from a real catalog, with rows that exercise every
-- column the entry migration has to carry across: decisions, notes, flags, manual rank,
-- website selection, a missing project, metrics, snapshots, stacks, and collector errors.
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
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  manual_rank INTEGER NOT NULL CHECK (manual_rank > 0),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  intent TEXT CHECK (intent IS NULL OR intent IN ('invest', 'maintain', 'experiment', 'hibernate', 'archive')),
  excitement INTEGER CHECK (excitement IS NULL OR excitement BETWEEN 1 AND 5),
  strategic_importance INTEGER CHECK (strategic_importance IS NULL OR strategic_importance BETWEEN 1 AND 5),
  next_action TEXT,
  review_after TEXT,
  is_missing INTEGER NOT NULL DEFAULT 0 CHECK (is_missing IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, missing_since TEXT, website_json TEXT);
CREATE INDEX projects_visible_rank ON projects(is_hidden, manual_rank);
CREATE INDEX projects_scan_root ON projects(scan_root);
CREATE TABLE project_metrics (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  head_sha TEXT,
  branch TEXT,
  latest_commit_at TEXT,
  latest_commit_subject TEXT,
  latest_commit_short_sha TEXT,
  commit_count INTEGER,
  commits_7d INTEGER,
  commits_30d INTEGER,
  commits_90d INTEGER,
  active_days_30d INTEGER,
  active_days_90d INTEGER,
  churn_added_30d INTEGER,
  churn_deleted_30d INTEGER,
  churn_added_90d INTEGER,
  churn_deleted_90d INTEGER,
  contributor_count INTEGER,
  local_author_commit_share_30d REAL CHECK (local_author_commit_share_30d IS NULL OR local_author_commit_share_30d BETWEEN 0 AND 1),
  dirty_files INTEGER,
  ahead_count INTEGER,
  behind_count INTEGER,
  latest_tag TEXT,
  commits_since_latest_tag INTEGER,
  loc_code INTEGER,
  loc_comment INTEGER,
  loc_blank INTEGER,
  loc_files INTEGER,
  loc_test INTEGER,
  dominant_language TEXT,
  loc_fingerprint TEXT,
  td_open_count INTEGER,
  td_in_progress_count INTEGER,
  td_blocked_count INTEGER,
  td_review_count INTEGER,
  td_total_non_closed_count INTEGER,
  td_stale_count INTEGER,
  github_repo_id TEXT,
  github_owner TEXT,
  github_name TEXT,
  github_visibility TEXT CHECK (github_visibility IS NULL OR github_visibility IN ('public', 'private', 'internal')),
  github_is_archived INTEGER CHECK (github_is_archived IS NULL OR github_is_archived IN (0, 1)),
  github_stars INTEGER,
  github_forks INTEGER,
  github_watchers INTEGER,
  github_open_issues INTEGER,
  github_open_prs INTEGER,
  github_draft_prs INTEGER,
  github_ready_prs INTEGER,
  github_owner_prs INTEGER,
  github_external_prs INTEGER,
  github_oldest_external_pr_at TEXT,
  github_merged_prs_30d INTEGER,
  github_merged_prs_90d INTEGER,
  github_external_issues_30d INTEGER,
  github_external_issues_90d INTEGER,
  github_latest_release_at TEXT,
  github_latest_release_tag TEXT,
  github_release_downloads INTEGER,
  github_ci_state TEXT CHECK (github_ci_state IS NULL OR github_ci_state IN ('success', 'failure', 'pending', 'neutral', 'unknown')),
  github_contributor_count INTEGER,
  github_traffic_views INTEGER,
  github_traffic_unique_visitors INTEGER,
  github_traffic_clones INTEGER,
  github_traffic_unique_cloners INTEGER,
  github_availability TEXT CHECK (github_availability IS NULL OR github_availability IN ('available', 'unavailable', 'unauthenticated', 'rate_limited')),
  github_traffic_availability TEXT CHECK (github_traffic_availability IS NULL OR github_traffic_availability IN ('available', 'unavailable', 'unauthenticated', 'rate_limited')),
  git_scanned_at TEXT,
  loc_scanned_at TEXT,
  td_scanned_at TEXT,
  github_scanned_at TEXT,
  github_traffic_scanned_at TEXT
, stack_scanned_at TEXT);
CREATE TABLE metric_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('github_stars', 'loc_code', 'github_traffic_views', 'github_traffic_unique_visitors', 'github_traffic_clones', 'github_traffic_unique_cloners', 'github_open_issues', 'github_open_prs')),
  captured_on TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (project_id, metric, captured_on)
);
CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('startup', 'scheduled', 'manual', 'project', 'cli')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0)
, lease_owner TEXT, heartbeat_at TEXT);
CREATE INDEX metric_snapshots_lookup ON metric_snapshots(project_id, metric, captured_on DESC);
CREATE INDEX scan_runs_recent ON scan_runs(started_at DESC);
CREATE INDEX scan_runs_active_lease ON scan_runs(status, heartbeat_at);
CREATE TABLE project_stacks (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  toolchain TEXT NOT NULL,
  declared TEXT NOT NULL,
  raw TEXT NOT NULL,
  source_file TEXT NOT NULL,
  PRIMARY KEY (project_id, toolchain, source_file)
);
CREATE INDEX project_stacks_toolchain ON project_stacks(toolchain);
CREATE TABLE toolchain_releases (
  toolchain TEXT NOT NULL,
  cycle TEXT NOT NULL,
  latest TEXT,
  release_date TEXT,
  eol_from TEXT,
  is_eol INTEGER NOT NULL CHECK (is_eol IN (0, 1)),
  is_maintained INTEGER NOT NULL CHECK (is_maintained IN (0, 1)),
  is_lts INTEGER NOT NULL CHECK (is_lts IN (0, 1)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (toolchain, cycle)
);
CREATE TABLE toolchain_baseline_status (
  toolchain TEXT PRIMARY KEY,
  availability TEXT NOT NULL CHECK (availability IN ('available', 'unavailable', 'rate_limited')),
  fetched_at TEXT NOT NULL,
  message TEXT
);
CREATE TABLE IF NOT EXISTS "collection_errors" (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collector TEXT NOT NULL CHECK (collector IN ('discovery', 'git', 'loc', 'issues', 'hosting', 'traffic', 'stack')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (project_id, collector)
);
CREATE INDEX collection_errors_active ON collection_errors(project_id, resolved_at);
CREATE TABLE website_pages (
  slug TEXT PRIMARY KEY,
  website_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, applied_at) VALUES
  (1, '2026-01-01T00:00:00.000Z'),
  (2, '2026-01-01T00:00:01.000Z'),
  (3, '2026-01-01T00:00:02.000Z'),
  (4, '2026-01-01T00:00:03.000Z'),
  (5, '2026-01-01T00:00:04.000Z'),
  (6, '2026-01-01T00:00:05.000Z');

INSERT INTO projects (
  id, canonical_path, relative_path, name, scan_root, is_favorite, is_hidden, manual_rank, note,
  intent, excitement, strategic_importance, next_action, review_after, is_missing,
  first_seen_at, last_seen_at, updated_at, missing_since, website_json
) VALUES
  ('project_alpha', '/code/Ongoing Dashboard', 'Ongoing Dashboard', 'Ongoing Dashboard', '/code',
   1, 0, 1000, 'the dashboard itself', 'invest', 5, 4, 'ship phase 1', '2026-12-31', 0,
   '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL,
   '{"slug":"ongoing","included":true,"status":"published"}'),
  ('project_beta', '/code/beta', 'beta', 'beta', '/code', 0, 1, 2000, '', NULL, NULL, NULL, NULL,
   NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-05T00:00:00.000Z', '2026-01-06T00:00:00.000Z',
   '2026-01-06T00:00:00.000Z', NULL),
  -- Two projects whose names slugify identically, to prove slugs are de-duplicated.
  ('project_gamma', '/code/nested/ongoing-dashboard', 'nested/ongoing-dashboard',
   'Ongoing Dashboard', '/code', 0, 0, 3000, 'a fork', 'hibernate', 1, 2, NULL, NULL, 1,
   '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL, NULL);

INSERT INTO project_metrics (project_id, branch, commits_30d, loc_code, github_stars, td_open_count, stack_scanned_at)
VALUES ('project_alpha', 'main', 42, 12000, 7, 3, '2026-02-01T00:00:00.000Z'),
       ('project_beta', 'trunk', 0, 10, NULL, NULL, NULL);

INSERT INTO metric_snapshots (project_id, metric, captured_on, value) VALUES
  ('project_alpha', 'github_stars', '2026-01-01', 3),
  ('project_alpha', 'github_stars', '2026-02-01', 7),
  ('project_alpha', 'loc_code', '2026-02-01', 12000);

INSERT INTO project_stacks (project_id, toolchain, declared, raw, source_file) VALUES
  ('project_alpha', 'bun', '1.4.2', '1.4.2', '.bun-version'),
  ('project_alpha', 'go', '1.27', 'go 1.27', 'go.mod');

INSERT INTO collection_errors (project_id, collector, message, occurred_at, resolved_at) VALUES
  ('project_alpha', 'hosting', 'gh not found', '2026-02-01T00:00:00.000Z', NULL),
  ('project_beta', 'git', 'not a repository', '2026-01-06T00:00:00.000Z', '2026-01-07T00:00:00.000Z');

INSERT INTO scan_runs (id, reason, status, started_at, finished_at, discovered_count, updated_count, error_count)
VALUES ('scan_1', 'scheduled', 'completed', '2026-02-01T00:00:00.000Z', '2026-02-01T00:01:00.000Z', 3, 3, 1);

INSERT INTO toolchain_baseline_status (toolchain, availability, fetched_at, message)
VALUES ('go', 'available', '2026-02-01T00:00:00.000Z', NULL);

INSERT INTO toolchain_releases (toolchain, cycle, latest, release_date, eol_from, is_eol, is_maintained, is_lts, fetched_at)
VALUES ('go', '1.27', '1.27.1', '2026-01-15', NULL, 0, 1, 0, '2026-02-01T00:00:00.000Z');

INSERT INTO website_pages (slug, website_json, updated_at)
VALUES ('about', '{"slug":"about","included":true,"status":"published"}', '2026-02-01T00:00:00.000Z');
