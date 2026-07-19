ALTER TABLE scan_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE scan_runs ADD COLUMN heartbeat_at TEXT;

CREATE INDEX scan_runs_active_lease ON scan_runs(status, heartbeat_at);
