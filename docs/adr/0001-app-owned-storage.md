# ADR 0001: Keep application storage app-owned

## Status

Accepted

## Decision

Ongoing stores its catalog, local annotations, preferences, and metric history in its own SQLite database. The default path is `.data/ongoing.sqlite` and may be overridden through configuration.

The application must not add tables to a repository's `.todos/issues.db`. Filesystem discovery remains authoritative; SQLite is an index and cache. Missing repositories are retained so local notes, favorites, ordering, and history survive temporary filesystem changes.

## Consequences

Application migrations are independent of TD migrations, backups have a clear boundary, and the catalog can evolve without coupling either project's schema. The ignored database is machine-local and is never committed.
