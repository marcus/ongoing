-- The catalog becomes a catalog of typed entries (ADR 0005). A project is an entry with
-- kind = 'project'; its decision fields move into the `attributes` document, and the columns that
-- describe where discovery found it move into `entry_sources`. The row copy itself runs in
-- TypeScript beside this file, because slugs have to be generated and de-duplicated.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  tags TEXT NOT NULL DEFAULT '[]',
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  attributes TEXT NOT NULL DEFAULT '{}',
  review_after TEXT,
  website_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, slug)
);

CREATE INDEX entries_kind ON entries(kind, is_hidden);

-- Discovery is a separate concern from identity: an entry may have several sources, or none at all
-- (a repository that exists only on GitHub, a hosted service, a technology nobody can cd into).
CREATE TABLE entry_sources (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  locator TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_since TEXT,
  PRIMARY KEY (entry_id, provider)
);

CREATE UNIQUE INDEX entry_sources_locator ON entry_sources(provider, locator);

-- User-defined fields. Built-in fields are declared in code and provider fields in a manifest;
-- only these are rows, because only these are created at runtime.
CREATE TABLE fields (
  key TEXT PRIMARY KEY,
  kinds TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT,
  label TEXT NOT NULL,
  description TEXT,
  sortable INTEGER NOT NULL DEFAULT 1 CHECK (sortable IN (0, 1)),
  filterable INTEGER NOT NULL DEFAULT 1 CHECK (filterable IN (0, 1)),
  editable INTEGER NOT NULL DEFAULT 1 CHECK (editable IN (0, 1)),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (evidence IN ('declared', 'detected')),
  provider TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (from_id, to_id, kind, evidence)
);

CREATE INDEX relations_from ON relations(from_id, kind);
CREATE INDEX relations_to ON relations(to_id, kind);

CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT,
  query TEXT NOT NULL DEFAULT '',
  columns TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
