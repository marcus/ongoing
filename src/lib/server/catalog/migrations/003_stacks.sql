ALTER TABLE project_metrics ADD COLUMN stack_scanned_at TEXT;

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

-- SQLite cannot widen a CHECK constraint in place, so `collection_errors` is rebuilt to admit the
-- new `stack` collector. The index from 001_initial.sql must be recreated with it.
CREATE TABLE collection_errors_next (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collector TEXT NOT NULL CHECK (collector IN ('discovery', 'git', 'loc', 'issues', 'hosting', 'traffic', 'stack')),
  message TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY (project_id, collector)
);

INSERT INTO collection_errors_next (project_id, collector, message, occurred_at, resolved_at)
SELECT project_id, collector, message, occurred_at, resolved_at FROM collection_errors;

DROP TABLE collection_errors;

ALTER TABLE collection_errors_next RENAME TO collection_errors;

CREATE INDEX collection_errors_active ON collection_errors(project_id, resolved_at);
