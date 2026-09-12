-- What each provider did on the last scan that considered it. One row per provider, rewritten every
-- scan, so `ongoing providers` and GET /api/providers can say when a provider last ran and why it
-- did not. It is operational state, not catalog data: dropping the table loses nothing but history.
CREATE TABLE IF NOT EXISTS provider_runs (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ok', 'skipped', 'disabled', 'unavailable', 'failed')),
  last_run_at TEXT NOT NULL,
  run_id TEXT,
  detail TEXT
);
