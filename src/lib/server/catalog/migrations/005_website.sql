-- New and existing projects have no public listing until explicitly selected.
ALTER TABLE projects ADD COLUMN website_json TEXT;
