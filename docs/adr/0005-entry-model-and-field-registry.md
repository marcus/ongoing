# ADR 0005: Catalog typed entries through a field registry rather than typed columns

## Status

Accepted

## Decision

Ongoing catalogs **entries**, not projects. One `entries` table carries `id`, `kind`, `slug`, `name`, `note`, `tags`, `is_favorite`, `is_hidden`, `review_after`, timestamps, and an `attributes` JSON document. A project is an entry with `kind = 'project'`; a technology is an entry with `kind = 'technology'`; further kinds are registered the same way.

Every value inside `attributes` belongs to a **registered field**. A field declares its key, the kinds that carry it, a type from a closed list (`text`, `number`, `integer`, `boolean`, `date`, `url`, `enum`, `multi_enum`, `json`), its options and limits, a label and description, whether it is sortable, filterable, editable, and required, and an owner: `core` for fields declared in code, `user` for rows in `fields` that the API and CLI create, `provider:<name>` for read-only fields a provider manifest contributes. `intent`, `excitement`, `strategic_importance`, `next_action`, `manual_rank`, `ring`, `tool_surface`, and `technology_kind` are all registered fields.

`validateEntryPatch(registry, kind, patch)` is the only path that turns an untrusted patch into stored attributes. It is pure, so the API, the CLI, and the browser run the identical function, and the browser can reject a value before sending it.

Discovery is a separate concern from identity. `entry_sources(entry_id, provider, locator, first_seen_at, last_seen_at, missing_since)` records where each provider found an entry; the filesystem provider writes the canonical path, and the existing missing and forget semantics become that provider's rules. An entry may therefore have several sources, or none.

Edges are rows: `relations(id, from_id, to_id, kind, evidence, provider, attributes, note, ...)`, unique on `(from_id, to_id, kind, evidence)`. Relation kinds are registered like fields, with the entry kinds they connect. `evidence` is `declared` or `detected`; detected rows belong to the provider that wrote them, are rewritten on every scan, and are never edited by hand.

Provider-collected metrics stay in their own typed tables keyed by entry id. The read model projects them into namespaced, read-only fields (`git.commits30d`, `github.stars`, `td.open`, `stack.go`) so that filtering and sorting cannot tell them apart from stored ones.

## Consequences

Adding a field or an entry kind is a row, not a migration, so the catalog can grow at the speed the user thinks rather than the speed a schema change ships. New fields are filterable, sortable, and editable across every surface the moment they are registered, because each surface reads the registry instead of a hand-written column list.

The cost is paid knowingly: nine well-typed columns become a JSON document, and SQLite no longer enforces their types. The registry enforces them instead, in one function with tests, and the store interface stays key, record, and simple scan — no JSON1 expressions in business logic — so the catalog can move to JSONL, Postgres, or a document store without touching domain code. At roughly one hundred entries, filtering and sorting an in-memory projection is fast enough that indexing attributes is not yet a question.

Keeping provider metrics in typed tables behind a projection is the conservative half of the decision. It preserves the existing collectors, snapshot history, and freshness gates unchanged, and defers the question of per-provider documents until a second hosting or issues provider exists to prove the shape.

`entry_sources` is what makes an entry that has no local checkout expressible at all: a repository that lives only on GitHub, a hosted service, or a technology nobody can `cd` into. Without it, "a project is a directory" stays baked into the primary key.
