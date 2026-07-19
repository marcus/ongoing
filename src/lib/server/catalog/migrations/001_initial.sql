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
);

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
);

CREATE TABLE metric_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('github_stars', 'loc_code', 'github_traffic_views', 'github_traffic_unique_visitors', 'github_traffic_clones', 'github_traffic_unique_cloners', 'github_open_issues', 'github_open_prs')),
  captured_on TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (project_id, metric, captured_on)
);

CREATE TABLE collection_errors (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collector TEXT NOT NULL CHECK (collector IN ('discovery', 'git', 'loc', 'issues', 'hosting', 'traffic')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (project_id, collector)
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
);

CREATE INDEX metric_snapshots_lookup ON metric_snapshots(project_id, metric, captured_on DESC);
CREATE INDEX collection_errors_active ON collection_errors(project_id, resolved_at);
CREATE INDEX scan_runs_recent ON scan_runs(started_at DESC);
