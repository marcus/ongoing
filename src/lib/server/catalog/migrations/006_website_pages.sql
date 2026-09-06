-- Public pages without a local repository are managed separately from scanned projects.
CREATE TABLE website_pages (
  slug TEXT PRIMARY KEY,
  website_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
