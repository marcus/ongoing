-- Provider metric tables keep their shape and are re-keyed from project_id to entry_id. Entry ids
-- are the project ids they replace, so the copy is a rename, not a remap. SQLite cannot repoint a
-- foreign key in place, so each table is rebuilt and its indexes recreated.
CREATE TABLE project_metrics_next (
  entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
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
  github_traffic_scanned_at TEXT,
  -- Column order matches the old table exactly, because the copy below is positional:
  -- migration 003 appended stack_scanned_at, so it stays last.
  stack_scanned_at TEXT
);

INSERT INTO project_metrics_next SELECT * FROM project_metrics WHERE project_id IN (SELECT id FROM entries);

DROP TABLE project_metrics;

ALTER TABLE project_metrics_next RENAME TO project_metrics;

CREATE TABLE metric_snapshots_next (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('github_stars', 'loc_code', 'github_traffic_views', 'github_traffic_unique_visitors', 'github_traffic_clones', 'github_traffic_unique_cloners', 'github_open_issues', 'github_open_prs')),
  captured_on TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (entry_id, metric, captured_on)
);

INSERT INTO metric_snapshots_next SELECT * FROM metric_snapshots WHERE project_id IN (SELECT id FROM entries);

DROP TABLE metric_snapshots;

ALTER TABLE metric_snapshots_next RENAME TO metric_snapshots;

CREATE INDEX metric_snapshots_lookup ON metric_snapshots(entry_id, metric, captured_on DESC);

CREATE TABLE collection_errors_next (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  collector TEXT NOT NULL CHECK (collector IN ('discovery', 'git', 'loc', 'issues', 'hosting', 'traffic', 'stack')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (entry_id, collector)
);

INSERT INTO collection_errors_next SELECT * FROM collection_errors WHERE project_id IN (SELECT id FROM entries);

DROP TABLE collection_errors;

ALTER TABLE collection_errors_next RENAME TO collection_errors;

CREATE INDEX collection_errors_active ON collection_errors(entry_id, resolved_at);

CREATE TABLE project_stacks_next (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  toolchain TEXT NOT NULL,
  declared TEXT NOT NULL,
  raw TEXT NOT NULL,
  source_file TEXT NOT NULL,
  PRIMARY KEY (entry_id, toolchain, source_file)
);

INSERT INTO project_stacks_next SELECT * FROM project_stacks WHERE project_id IN (SELECT id FROM entries);

DROP TABLE project_stacks;

ALTER TABLE project_stacks_next RENAME TO project_stacks;

CREATE INDEX project_stacks_toolchain ON project_stacks(toolchain);

-- Everything the projects table carried now lives in entries or entry_sources.
DROP TABLE projects;
