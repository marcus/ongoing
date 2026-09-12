# Ongoing as a software inventory

**Status:** active, in implementation. Decisions 1 through 5 and every open question are settled
(Phase 0, 2026-09-11). Phases 1 and 2 are built: the catalog is entries over a field registry, with
relations and saved views, and one query grammar reads it from every surface. Phases 3 through 6 are
unbuilt. Each phase has a td epic, listed in its section.

Inputs: the running dashboard and its Fractal model (`docs/diagrams/fractal/`), the tech radar
model (`implemented/tech-radar.md`, this plan's Phase 3 companion), the project-standards brief
(`~/code/clara-home/docs/plans/active/agentic-sdlc-project-standards.md`), the `project-standards`
skill, td-c757bc, td-3a561b, and what LeanIX gets right and wrong.

## Summary

Ongoing started as an attention dashboard: which of ~100 local repositories deserves a few hours.
The more it is used the more it wants to be the **inventory** those decisions sit on: what exists,
what it is built with, how it relates to everything else, what state it is in, and what an agent
needs to know before touching it. The attention views stay. They become one lens over a richer
catalog rather than the product.

Four things drive the redesign:

1. **Jump and edit fast.** Any entry reachable in two keystrokes; any value changed without leaving
   the list; the same edit one flag away in the CLI.
2. **Sort and filter for real.** Multi-field filters, multi-key sorts, chosen columns, saved views,
   all URL-addressable and identical in the CLI and the API.
3. **A schema that grows.** New fields without a migration, new entry kinds without a rewrite,
   relations between entries, and provider-contributed data that stays namespaced.
4. **Seams instead of assumptions.** GitHub, td, endoflife.date, cloc, launchd, `~/code`, OpenTangle
   and aerie are all currently baked in. Each becomes an adapter that can be off, so the project can
   be open-sourced without forking it for every other machine.

## What to take from LeanIX, and what to refuse

LeanIX is an enterprise architecture inventory. Its UI is a generic pattern applied to everything,
which is the part to refuse. Its model is mostly right.

| Take                                                            | Why it matters here                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Typed entries ("fact sheets") with a defined field set per type | Projects and technologies are different things with different fields; both are entries |
| Relations as first-class rows with their own attributes         | "uses Go 1.27", "provided by td", "depends on comms" carry evidence and versions       |
| Lifecycle as a field with a vocabulary                          | `intent` already is this; keep it                                                      |
| Completeness per entry                                          | "Which projects have no intent, no tool surface, no note" is a real query              |
| Tags, saved views, and an inventory table with inline edit      | The daily surface                                                                      |
| Subscriptions and ownership                                     | Only as an optional owner field; single user stays a non-goal                          |

| Refuse                                                                     | Our answer                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Every screen is the same list-of-cards with a configurable attribute panel | Opinionated screens per kind; flexibility lives in the model and the query layer, not the chrome |
| Attribute panels with dozens of collapsible sections                       | A fact sheet shows what has a value and hides the rest behind one "empty fields" toggle          |
| Dashboards of charts as the landing page                                   | The inventory table is the landing page; a sparkline where a trend matters                       |
| Workflow and approval machinery                                            | None                                                                                             |

## Goals

- One catalog of typed entries: projects first, technologies second, further kinds without a rewrite.
- Every capability has a CLI verb and a JSON shape before it has a button.
- A query model (filter, sort, columns, saved views) shared by CLI, API, and browser.
- Fields and relations can be added by a user at runtime and are immediately filterable, sortable,
  and editable everywhere.
- Every external dependency behind an adapter with a manifest, switchable in configuration.
- A frontend that is dense, keyboard-first, and quiet, starting from the Linear patterns and
  growing into a house style.
- Open-source ready: install, configure, run, and deploy on a machine that is not aerie.

## Non-goals

- Multi-user, permissions, or workflow. One owner per instance.
- A full dependency graph of every package. Edges exist only for catalogued technologies.
- Replacing td, GitHub, or Sidecar surfaces. Ongoing points at them.
- Cost tracking, scoring, or a portfolio grade.

## Standing constraints

These follow from the existing ADRs and Marcus's design principles and were never in question.

- App-owned storage, filesystem discovery authoritative for local projects (ADR 0001).
- Providers behind domain-owned interfaces; a provider failure never fails a scan (ADR 0002, 0003).
- One HTTP contract for browser and CLI; no UI-only capability (AGENTS.md, `surface-parity`).
- Pure domain rules with no I/O, so the browser can re-run them after an optimistic edit.
- No grand score. Attention views stay independent, transparent classifications.
- Auth stays disabled on aerie. The redesign does not touch the auth model.

## Decision 1: backend language — settled

**Ongoing stays on SvelteKit and Bun.** One TypeScript core, one process serving the UI and the
API, and the domain rules shared verbatim with the browser so an optimistic edit can re-run them.
A Go rewrite would buy a single binary at the price of a second implementation of every rule in
the browser; `bun build --compile` is the cheaper answer and is a Phase 6 spike, not a premise.

**The CLI gains a transport adapter.** `ongoing` links the core library in-process when no service
is running and speaks HTTP when one is, so `ongoing scan` and `ongoing list` work with no daemon.

Reopen only on a trigger: the scanner must run on hosts without Bun; the browser stops needing
shared domain code; or a standalone `ongoing` binary under Bun proves unreliable.

## Decision 2: the entry model — settled

**One `entries` table with a `kind`, a typed field registry, JSON `attributes`, and a `relations`
table.** Provider-collected data stays in its own tables keyed by entry id and is projected into
namespaced fields by the read model. Adding a field or an entry kind is a row, not a migration;
the price paid knowingly is that nine well-typed project columns become a JSON document validated
by the registry instead of by SQLite. ADR 0005 records this.

### Entries

| Column                     | Notes                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `id`                       | stable, as today                                                                        |
| `kind`                     | `project`, `technology`, later others; registered like a field                          |
| `slug`                     | unique per kind; what URLs and the CLI use (`ongoing show td`, `/p/td`, `/t/sveltekit`) |
| `name`                     | display name                                                                            |
| `note`                     | free text, as today                                                                     |
| `tags`                     | JSON array of strings                                                                   |
| `is_favorite`, `is_hidden` | as today                                                                                |
| `attributes`               | JSON object of registered field values, including `manual_rank`                         |
| `review_after`             | as today; kind-agnostic                                                                 |
| `created_at`, `updated_at` |                                                                                         |

`intent`, `excitement`, `strategic_importance`, `next_action`, `manual_rank`, and the tech radar's
`ring`, `tool_surface`, and `technology_kind` all become registered fields living in `attributes`.
`manual_rank` is an ordinary sparse integer field: it stays a sort key, its sparse-assignment rule
moves into the field's domain helper, and reordering becomes a palette and CLI command over it
rather than a table interaction.

### Sources

A project is an entry that a provider found somewhere. Discovery-owned columns move to
`entry_sources(entry_id, provider, locator, first_seen_at, last_seen_at, missing_since)`. The
filesystem provider writes `locator = canonical_path`. This is what later allows an entry with no
local checkout, a repository that exists only on GitHub, or a hosted service. Missing and forget
semantics are unchanged; they become the filesystem provider's rules.

### Field registry

Built-in fields are declared in code as a table. User fields are rows in `fields` and are
API-editable. Provider fields are declared in the provider manifest and are read-only.

| Property                             | Values                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `key`                                | `intent`, `github.stars`, `ring`, `owner`, `x.customer`                             |
| `kinds`                              | which entry kinds carry it, or `*`                                                  |
| `type`                               | `text`, `number`, `integer`, `boolean`, `date`, `url`, `enum`, `multi_enum`, `json` |
| `options`                            | enum values, min and max, max length                                                |
| `owner`                              | `core`, `user`, or `provider:<name>` (read-only)                                    |
| `label`, `description`               |                                                                                     |
| `sortable`, `filterable`, `editable` | booleans                                                                            |
| `required`                           | counts toward completeness for its kinds                                            |

Validation is one pure function over the registry and a patch, used by the API, the CLI, and the
browser before sending. `ongoing set <entry> intent invest` and `ongoing set <entry> x.customer acme`
go through the same path.

Provider-owned metric tables (`project_metrics`, `project_stacks`, `metric_snapshots`) do not move
in this plan. The read model projects them into namespaced fields (`git.commits30d`, `github.stars`,
`td.open`, `stack.go`), so filtering and sorting treat them like any other field. They stay typed
tables behind that projection; re-homing them into per-provider JSON documents waits for a second
hosting or issues provider to exist and prove the shape wrong.

### Relations

`relations(id, from_id, to_id, kind, evidence, provider, attributes, note, created_at, updated_at)`,
unique on `(from_id, to_id, kind, evidence)`. Relation kinds are registered like fields with the
entry kinds they connect: `uses` (project → technology), `provides` (project → technology),
`depends_on` (project → project), `part_of` (project → project). `evidence` is `declared` or
`detected`; detected rows are rewritten by their provider on every scan and never edited by hand.

Phase 3 ships `uses` and `provides` only. `depends_on` and `part_of` stay registered kinds with no
writer until a real question ("what breaks if I retire comms") arrives — "provided by project X"
already answers the version of it that comes up today, and a project-to-project edge nobody
maintains is worse than no edge.

### Saved views

`saved_views(id, name, kind, query, columns, position)`. A query is the same string the CLI and URL
carry, so a saved view is a bookmark, not a second query language.

### Storage stance

Attributes as one JSON document per entry, filtered and sorted in the read model, keeps the store
interface to key, record, and simple scans. No JSON1 expressions in business logic. At the catalog's
size this is fast and it survives a move to JSONL, Postgres, or a document store unchanged.

## Decision 3: the query model — settled

**One filter grammar, parsed by a pure domain function, used by the API, the CLI, and the browser.**
A query is a string; a saved view is a stored query plus columns; the URL, the `--saved` flag, and
the API parameter all carry the same text. There is no second query language and no UI-only filter
state. Existing `--view`, `--filter`, `--stack`, and `--search` flags survive as clause aliases.
ADR 0006 records this.

```
filter   := clause (' ' clause)*
clause   := field op value | 'tag:' value | 'view:' attentionView | 'tech:' slug | 'kind:' kind | text
op       := ':' | '!:' | '>' | '>=' | '<' | '<=' | ':~'          (equals-any, not, compare, contains)
value    := token | token ',' token ...                          (comma = any of)
sort     := ['-'] field (',' ['-'] field)*
```

```sh
ongoing list 'intent:invest,maintain github.stars>=100 -tag:archived' --sort -git.commits30d,name
ongoing list 'view:upgrade tech:go' --columns name,stack.go,git.latestCommit --json
ongoing list --saved oss-momentum
```

Bare text searches name, slug, path, and note, as today. Unknown fields error with the closest
registered key. The browser builds the same string from its filter UI and puts it in the URL.

## Decision 4: provider seams — settled

**Every collector becomes a provider with a manifest, and every baked-in assumption becomes a named
adapter that can be switched off.** The manifest is what makes the seam real: it declares the fields
and relation kinds a provider contributes, what it needs to run, and when it runs. Configuration
lives in one TOML file with environment variables as overrides — `~/.config/ongoing/config.toml`,
`--config` to point elsewhere — because a list of enabled providers with per-provider settings is
not something environment variables express honestly. ADR 0007 records this.

```ts
interface ProviderManifest {
  name: 'git' | 'github' | 'td' | 'loc' | 'stack' | 'endoflife' | 'tech-signatures' | string;
  kinds: EntryKind[]; // what it enriches or discovers
  fields: FieldDefinition[]; // namespaced, read-only
  relations?: RelationKindDefinition[];
  requires?: { commands?: string[]; env?: string[]; network?: boolean };
  schedule: 'every-scan' | 'when-changed' | 'daily';
}
```

Configuration lists enabled providers. A disabled provider contributes no fields, so attention
rules that read them are inert rather than wrong, which is the freshness gate the rules already
have. `ongoing providers` reports each provider's availability, last run, and what it contributes.

The seams that exist only by convention today and need a named adapter:

| Assumption                          | Adapter                                             | Default        | Alternatives that should be possible      |
| ----------------------------------- | --------------------------------------------------- | -------------- | ----------------------------------------- |
| Repos live under `~/code`           | discovery provider (`filesystem`)                   | as today       | GitHub org listing, a manifest file, none |
| GitHub is the host                  | hosting provider                                    | `github`       | GitLab, Gitea, none                       |
| td is the tracker                   | issues provider                                     | `td`           | GitHub issues, Linear, none               |
| endoflife.date                      | release baseline provider                           | as today       | none, a vendored table                    |
| cloc                                | loc provider                                        | as today       | tokei, scc, none                          |
| launchd on aerie                    | host adapter for `serve`, `scan`, `restart`, `logs` | `launchd`      | systemd, docker, none (foreground)        |
| Deploy to `marcus@aerie.local`      | deployment profile in `deploy/aerie/`               | aerie          | any profile a user writes                 |
| OpenTangle reads the website export | export profile                                      | `opentangle`   | generic JSON, none                        |
| Intent and ring vocabularies        | enum options in the field registry                  | Marcus's words | anyone's words                            |

Deployment scripts move out of the core. `scripts/release-*.ts` and the aerie constants become a
profile the core does not import. The core gains `ongoing serve --data-dir`, `ongoing scan`, and
`ongoing init`, which is all a new user needs.

## Decision 5: frontend direction — settled

**Start from `linear-design-patterns`, then drift into a house style on purpose.** The current
`dashboard.css` monolith and mockup-derived layout are replaced, not restyled; the house style is
written down in `DESIGN.md` as it drifts so the drift stays deliberate. ADR 0008 records this.

Screens:

- **Inventory.** Left rail: kinds, attention views, saved views, radar, providers. Main: a table
  with chosen columns, inline editing, `j`/`k`, `/` for filter, `,` for sort, `c` for columns.
  Right: a detail panel that opens on `Enter` without leaving the list.
- **Entry page** (`/p/<slug>`, `/t/<slug>`): the fact sheet. Identity, decision fields, provider
  panels (only providers with data), relations, attention reasons with their thresholds, history.
  Every field editable in place.
- **Palette** (`Cmd+K`): jump to any entry by fuzzy name, run a command against the selected entry
  (`set intent`, favorite, hide, open in terminal, open on GitHub), switch view. `g p`, `g t`,
  `g r` navigation.
- **Radar.** Four rings as rows, technologies as chips with counts, click through to a filtered
  inventory. Ring is editable on the chip.
- **Providers.** Availability, last run, contributed fields, enable state.

Design rules: dark-first LCH tokens, Inter, 4px grid, 1px borders, no nested containers, no
shadows on data, colour only for status and accent, `roc` icons, optimistic updates with undo.
Reusable components live in `src/lib/ui/` (Table, cell editors per field type, Palette, Panel,
Rail, Badge, Sparkline). The existing drawer's "reason with input, comparison, threshold" display
is a strength and carries over as-is into the fact sheet.

What goes: the catalog ticker, the header flyout filter, the per-component absolute font sizes,
drag reorder as a primary interaction (manual rank stays as a sort key, reorder moves to the
palette and CLI).

## Phases

Dependencies are noted per phase. Phases 3 and 4 can run as parallel tracks once Phase 2 lands;
Phase 5 can start any time after Phase 1.

### Phase 0: decisions and housekeeping — done (td-7a51f7)

- Discuss and settle Decisions 1 through 5; rewrite this section as they settle.
- Write ADRs 0005 (entry model and field registry), 0006 (query model), 0007 (provider manifests
  and host adapters), 0008 (frontend design system).
- Move `docs/plans/ongoing-projects-dashboard.md` to `implemented/`; fold `tech-radar.md` into
  this plan or move it to `active/` as the radar's detailed model. Point td-c757bc and td-3a561b
  at this plan; file one td epic per phase.
- Update the Fractal model's proposed scene to describe this plan, not just the radar.

Evidence: ADRs merged, td epics filed, `fractal validate` clean.

**Handoff (2026-09-11).** Every lean is now a settled statement in the sections above; the plan is
the specification Phase 1 builds from, and nothing in it is open. The ADRs carry the reasoning, so
a phase agent should read `docs/adr/0005`–`0008` before the phase section rather than re-deriving
it. The tech radar sketch stayed a separate document, `tech-radar.md` beside this one, as Phase 3's
detailed model — it is long, specific to one phase, and easier to close out than to keep inline;
its own open questions are settled there. `docs/plans/implemented/ongoing-projects-dashboard.md`
still describes the shipped product and is the reference for behaviour Phase 1 must not break.
Phase epics: td-1e9a01, td-a4b0b6, td-1155ba, td-d843f6, td-c5dc7d, td-daa20f, with dependencies
recorded in td. td-c757bc and td-3a561b now point here and are Phase 3's to close. The Fractal
model's proposed scene now covers the whole plan (`inventory` subsystem, `proposed-inventory`
scene); Phase 1 extends it rather than replacing it. Nothing was built, migrated, or deployed.

### Phase 1: entry model, field registry, relations — done (td-1e9a01)

- Migration: `entries`, `entry_sources`, `fields`, `relations`, `saved_views`. Projects migrate in
  place with `kind = 'project'`; decision fields move into `attributes`; discovery columns move to
  `entry_sources`. Metric tables re-key to entry id without changing shape.
- Repository interface rewritten around entries; no caller sees SQL or JSON layout.
- Built-in field table in code; provider fields projected from metric tables in the read model.
- `validateEntryPatch(registry, kind, patch)` as the one validation path.
- API: `GET /api/entries`, `GET/PATCH /api/entries/:kind/:slug`, `GET/POST/DELETE /api/fields`,
  `GET/POST/DELETE /api/relations`, `GET/POST/PATCH/DELETE /api/views`. `/api/projects` stays as
  a thin alias until Phase 4 ships.
- CLI: `ongoing get <entry> [field]`, `ongoing set <entry> <field> <value>` (existing `--intent`
  style flags kept as aliases), `ongoing field list|add|remove`, `ongoing tag`, `ongoing link`,
  `ongoing unlink`, `ongoing view save|list|delete`.
- The existing browser UI keeps working unchanged on top of the new model.

Evidence: existing Vitest and Playwright suites pass; a user field added by CLI shows in
`ongoing show` and `ongoing list --json`; a declared relation round-trips; the production catalog
migrates on aerie with a verified backup.

**Handoff (2026-09-11).** Built and pushed. The catalog is now `entries`, `entry_sources`, `fields`,
`relations`, and `saved_views` (migrations 007 and 008); the `projects` table is gone and
`project_metrics`, `metric_snapshots`, `project_stacks`, and `collection_errors` are keyed by
`entry_id` with their shape unchanged. Entry ids are the old project ids, so nothing was re-keyed in
substance. Migration 007 does its row copy in TypeScript (`migrations/007_entries.ts`) because slugs
have to be generated and de-duplicated; `migrations.ts` grew an optional `migrate` hook for that,
which runs inside the same transaction as the file's statements.

Proof on real data: a copy of the production catalog migrated losslessly — 144 projects became 144
entries and 144 filesystem sources, with every favourite, note, manual rank, missing timestamp, and
website record intact, all 21,352 snapshots, 124 stack rows, 119 collector errors, 165 release rows
and 4 website pages carried over, identical metric checksums, and no foreign-key violations.
`tests/fixtures/catalog/v6.sql` is the same schema with rows that exercise each of those columns, and
`tests/integration/catalog.test.ts` asserts the migration against it.

The shape to build on: `src/lib/domain/entry.ts` (entry types, slugs, tags), `fields.ts` (the
registry, `validateEntryPatch`, `parseFieldInput`), `provider-fields.ts` (the namespaced projection),
`relation.ts`, `view.ts`. `CatalogRepository` is the one store interface — `listEntries`, `getEntry`,
`getEntryBySlug`, `createEntry`, `patchEntry`, `deleteEntry`, sources, `registry()`, user fields,
relations, saved views — with the project methods kept as a projection over the same rows, so the
dashboard, the scanner, and the collectors were not touched. `src/lib/server/catalog/entries.ts` is
the read model: it merges columns, attributes, and provider projections into one flat `fields` map,
which is what Phase 2's query evaluator should filter and sort over.

Three judgment calls worth knowing. `POST /api/entries` and `DELETE /api/entries/:kind/:slug` (plus
`ongoing entry add|list|remove`) are not in the list above, but a technology has no discovery to
create it and Phase 3 seeds technologies through the CLI, so the model needed them. `untag` is its
own verb because `-tag` parses as a flag. And `website_json` stayed a column on `entries` rather than
becoming a registered field, because the website document has its own validator and becomes an
export profile in Phase 5.

Two repairs on the way through. `PRODUCTION_SCAN_PATH` did not resolve `gh`, which is installed
through mise on this machine rather than Homebrew, so the scheduled scan has been reporting GitHub
unavailable; the shim directory is on the path now and the probe runs with the HOME launchd actually
supplies. And the Playwright seed's fixed July timestamps had aged past the attention rules'
freshness gates, failing three browser tests for reasons unrelated to the code; the seed is now
anchored to the moment it runs. `playwright.config.ts` takes `E2E_PORT` so a busy 5173 no longer
silently tests whatever else is listening there.

Not done here, deliberately: `/api/entries` still takes `kind` and `hidden` rather than `q`, `sort`,
`columns`, and `saved` (Phase 2 owns the grammar), `ongoing list` still reads `/api/projects`, and
nothing seeds technologies (Phase 3). The production service has not been restarted; Marcus will do
that once the plan lands, and the migration runs on first open.

### Phase 2: query model and CLI parity — done (td-a4b0b6)

Depends on Phase 1.

- Query parser and evaluator in `src/lib/domain/query.ts`, pure, with the error messages the CLI
  and UI will show.
- `GET /api/entries?q=&sort=&columns=&saved=` replaces the fixed `sort`, `filter`, `view`,
  `stack` parameters; the old ones map onto query clauses for one release.
- `ongoing list` rewritten on the query model: `--sort` with multiple keys, `--columns`,
  `--saved`, `--json`, `--paths`, `--ids`, `--count`. Every existing flag keeps working as a
  clause alias.
- `ongoing views` and `ongoing stacks` become saved views shipped by default.

Evidence: docs/cli.md rewritten; a table of old flag → new clause with tests; parser fuzz test
over registered fields.

**Handoff (2026-09-11).** Built and pushed. Reading the catalog is now one grammar:
`src/lib/domain/query.ts` parses it (totally — every string is a query) and evaluates it, and
`validateQuery`, `validateSort`, and `validateColumns` are where anything fails, against the field
registry, with the message every surface shows. `GET /api/entries?q=&sort=&columns=&saved=` is the
single read endpoint and returns the matched entries, the echoed query and sort, the field registry
for the kind, the release baselines, and the latest scan — everything `ongoing list`, `views`, and
`stacks` need, so nothing in the read path touches `/api/projects` any more except `show` and
`status`, which want the attention reasons the project projection still carries.

The shape to build on. Every clause in the grammar is a **field** clause: `tag:` and `view:` are
singular aliases for `tags` and `views`, and `tech:` and `kind:` are fields. That required the read
model (`src/lib/server/catalog/entries.ts`) to derive `path`, `is_missing`, `views`, `warnings`,
`tech`, `stack.lag`, `github.starsGained30d`, and `github.trafficViewsDelta30d`, and `kind` became a
core field — so the evaluator has one shape and Phase 4's filter UI has one thing to build. An
`EntryView` now also carries its resolved `stacks`, `errors`, `path`, and `views`, which is what let
`ongoing stacks` move onto the entries endpoint. `readEntryViews` therefore classifies attention for
every project on each call, the same work `/api/projects` already did per request; if the catalog
grows enough for that to hurt, the fix is a bulk snapshot read, not a second endpoint.

Old flags map onto clauses through one exported table, `legacyParamsToQuery`, used by both the route
and the CLI and asserted row by row in `query.test.ts`; docs/cli.md prints the same table. Saved
views ship built in (`builtinSavedViews` in `src/lib/domain/view.ts`) — declared in code beside
`builtinFields` for the same reason — covering the attention views, the toolchains as
`stack-<toolchain>`, favourites, hidden, missing, warnings, and technologies. A stored view of the
same name shadows a built-in; deleting a built-in is refused.

Three judgment calls. `:` on a text field is equality and `:~` is contains, because ADR 0006's
operator table is the authority and a `:~` that duplicated `:` would be a dead operator; bare text
is still the substring search people reach for. `--filter warnings` is now `warnings>0`, which is
narrower than the old flag — that also matched anything in `view:attention` — because the grammar
has no OR, so it is two queries now. And a legacy sort alias keeps its old descending default only
when it is not itself a field key (`latestCommit` does, `name` does not), which is what makes
`formatSort`'s output safe for the server to re-parse without flipping direction twice; `?sort=name`
consequently sorts A→Z rather than Z→A.

Not done, deliberately: the **browser was left alone**. The dashboard still reads `/api/projects`
with `?sort=&dir=&filter=&view=&stack=&q=`, where `q` is the old search box rather than a query
string. Making it build the grammar would mean changing what `q` means in a URL people have
bookmarked and reworking the header flyout and sort controls — all of which Phase 4 deletes
(`dashboard.css`, the ticker, the flyout, the drawer). The cheap half is already done for it: the
evaluator, the registry, and `legacyParamsToQuery` are pure and importable from the browser, so the
new shell can build `?q=&sort=` against `/api/entries` without a server change. `/api/projects` kept
its exact contract for the same reason.

One repair on the way through: `playwright.config.ts` set `reuseExistingServer` whenever CI was
unset, so a stranger already listening on `E2E_PORT` absorbed the whole browser suite (a Fractal
server on 5199 failed all fifteen tests with 404s). Naming a port now turns reuse off.

### Phase 3: technologies and the radar — done (td-1155ba)

Depends on Phase 1. Runs alongside Phase 2 or 4.

Detailed model: [tech-radar.md](../implemented/tech-radar.md) — ring vocabulary, signature detection, the `uses`
edge, the surfaces, and the steel thread. It is this phase's specification, rewritten onto the
entry model; where the two disagree, this plan wins.

- `technology` kind with fields `technology_kind`, `ring`, `tool_surface`, `review_after`;
  relation kinds `uses` and `provides`.
- Seed the six technologies from the radar model through the CLI, not a migration.
- `tech-signatures` provider: manifest-dependency signatures inside the stack collector's parse
  pass; languages read from `project_stacks`. Detected `uses` edges rewritten every scan.
- CLI: `ongoing tech list|show|add|set|export`, `ongoing show <project>` gains a uses section,
  `list 'tech:go'` works through the query model.
- Attention: an `out` technology in use, or a stale ring, is a reason in the existing views.
- `ongoing tech export --json` feeds the `project-standards` generator; the language and
  tool-surface tables in the skill become generated. Closes td-c757bc and td-3a561b.

Evidence: `ongoing tech show go` lists every Go project with versions; the skill regenerates from
the export with no hand edits.

**Handoff (2026-09-12).** Built and pushed. A technology is an entry, a ring is a field, a usage is a
relation, and nothing in the radar needed a table of its own. The parts to build on:

`src/lib/domain/technology.ts` is the radar — the seed list, the signature table that is the whole
detector, the matchers the collector runs over one manifest, the ring vocabulary and the staleness
rule, and the deterministic export. It is pure data and pure rules, imported unchanged by the API,
the CLI, and the generator. Adding a technology means adding a seed and, if a manifest can see it, a
signature beside it; a test asserts every signature names a seeded technology and that every manifest
a signature mentions has a parser, so a signature can never silently never match.

Detection lives in the stack collector's existing pass (`collectStack` now returns
`{ stacks, technologies }` and shares one read cache), and
`CatalogRepository.replaceDetectedTechnologyUsage` writes the edges: the `tech-signatures` provider's
detected rows are replaced whole on every scan, so a dropped dependency loses its edge, while
declared edges and their notes are never touched. Languages come from the declarations the same pass
collected rather than a second parse, which is what the radar meant by "languages read from
`project_stacks`".

Three judgment calls worth knowing. **The seed list is 21 technologies, not the radar's six**, because
the `project-standards` skill's language and tool tables are generated from this catalog and every row
they carry has to exist in it — seeding six would have deleted prose rather than reproducing it.
**`tech seed` fills rather than overwrites**: a missing technology is created, an empty field is
filled, and a value someone has since changed is left alone unless `--force` says otherwise, so a
re-seed never undoes `ongoing tech set go --ring warm`. And **the two radar attention reasons are
ungated** — an edge and a ring are catalog facts, like `isMissing` and collector warnings, not
measurements with a freshness window, so they do not sit behind `stackScannedAt`. An `out` technology
in use is an `upgrade` reason; a ring past `review_after` puts its users in `attention`.

Proof on real data: the dev catalog (136 projects) seeded 21 technologies and a scan detected 15 Go
projects with their declared versions, 46 on JavaScript/TypeScript, 24 carrying `.todos`, 19 on
SQLite, 10 on SvelteKit. `ongoing tech show go` prints all fifteen with versions and evidence, and
`scripts/render-project-standards.ts` regenerates the skill's two tables with `--check` clean on a
second run. The skill itself is committed in `marcus-skills` with the markers around both tables.

Not done, deliberately: the **radar web page** (Phase 4 draws it; the CLI view is what this phase was
asked to prove), a **`/api/technologies` route** (the export is a pure function over
`GET /api/entries`, and ADR 0006 makes that the single read endpoint — a second route would be a
second contract for the same rows), and a **provider manifest** for `tech-signatures`, which is
Phase 5's shape and stays proposed in the Fractal model.

**Production is not seeded.** The seed ran against the local dev catalog only. After the next deploy,
run `ongoing tech seed` once against production and then a scan, which is what fills the detected
edges. The production service is still running the pre-Phase-1 bundle against an already-migrated
catalog (`ongoing status` reports `no such table: projects`); it needs `bun run build` and a launchd
bootout/bootstrap, which is Marcus's call rather than a phase agent's.

### Phase 4: frontend redesign — done (td-d843f6)

Depends on Phase 2 for the table; the design-system spike can start during Phase 1.

- Tokens and `src/lib/ui/` components, built against the Linear patterns, documented in a
  `DESIGN.md` so the house-style drift is deliberate.
- Shell: rail, inventory table with column chooser and inline editors, detail panel, keyboard map.
- Palette with entry jump and commands.
- Entry pages for projects and technologies; the radar page; the providers page.
- Remove `dashboard.css`, the ticker, the flyout, drag reorder, and the old drawer.
- Playwright: jump to an entry, edit a field inline, save a view, and confirm the CLI sees each.

Evidence: every browser mutation has a CLI equivalent test; Lighthouse-style interaction under
100 ms for list operations at 500 entries; screenshots in `docs/qa/`.

**Handoff (2026-09-12).** Built. The browser is the inventory now: `src/routes/(inventory)/` is one
route group over one `+layout.server.ts` that reads the whole catalog once, and `/`, `/p/<slug>`,
`/t/<slug>`, `/radar` and `/providers` live inside it. `dashboard.css`, the ticker, the flyout, the
drawer, the project list and row, the theme picker, the activity bars, and `/hidden` are gone;
`?saved=hidden` is the hidden shelf, and manual rank is a palette command rather than a drag.

The shape to build on. `src/lib/ui/` is the design system — `Table`, `FieldEditor` (one editor per
registered type), `Palette`, `Panel`, `Rail`, `Badge`, `Sparkline`, `Icon`, plus the pure modules
`query-state.ts`, `facts.ts`, `palette.ts`, `format.ts`, `providers.ts`, `views.ts` and the client
store `catalog.svelte.ts`, which is the one place a mutation happens. Everything resolves to a token
in `tokens.css`; **no component declares a font size or a colour literal**, which is the rule that
makes an app-wide change one edit instead of 1,468. `DESIGN.md` at the repo root documents the
tokens, the components, the keyboard map with each key's CLI equivalent, and the deliberate drift
from the Linear patterns. Columns and fact-sheet sections are driven by field definitions, so a
field added by `ongoing field add` renders and edits with no frontend change.

Three judgment calls worth knowing. **The whole catalog is loaded once and filtered in the
browser.** `filterRows` and `sortRows` are pure and already shipped, so a filter, a sort, or a
column change is a local recompute rather than a fetch — which is what actually meets the 100 ms
budget, and what makes the layout load deliberately independent of `url` so SvelteKit does not
re-run it on every query change. **`listDefaultClauses` moved into `src/lib/domain/query.ts` and is
now shared with `ongoing list`**: both prepend `kind:project` and `is_hidden:false` when the query
has not spoken about them, because a URL and a CLI invocation that "mostly agree" is worse than
either rule alone; the filter box shows the effective query, defaults included. And **`EntryView`
moved to `src/lib/domain/entry-view.ts` and gained `metrics` and `attention`** — the browser cannot
import `$lib/server`, and re-running `classifyAttentionViews` after an optimistic edit needs the
metric row and the reasons. That is the only change to a Phase 1–3 contract.

Evidence. 15 Playwright tests in `tests/e2e/inventory.test.ts` jump to an entry, edit a field
inline, save a view, edit a ring on a radar chip, and confirm `bin/ongoing` sees each against the
same server through `tests/e2e/cli.ts`; a refused edit rolls back with the API's own message; one
test times a sort inside the page with a `MutationObserver` and `src/lib/domain/query.perf.test.ts`
asserts the same list operations under 100 ms over 500 synthetic entries. `optimistic.test.ts` and
`query-state.test.ts` cover the pure rules. Screens are in `docs/qa/screens/`, dark and light,
regenerated with `QA_SCREENSHOTS=1 E2E_PORT=7801 bun run test:e2e tests/e2e/screenshots.test.ts`.
The Playwright suite now runs on one worker: it shares one seeded catalog and several tests mutate
it, so parallel workers made `is_favorite:true` mean whatever another worker was mid-way through.

Not done, deliberately. **`GET /api/providers` does not exist** — Phase 5 adds it — so
`src/lib/ui/providers.ts` declares the typed `ProviderStatus` shape the screen renders and falls
back to what the field registry knows, marking availability and last run unknown rather than
guessing; the TODO there names the route and the epic. **Live scan progress left the browser**: the
rail has a scan button that POSTs `/api/scan` and re-reads the catalog, but the SSE ticker is gone
and `ongoing scan --wait` is where a run is followed. **`svelte/no-navigation-without-resolve` is
off** in `eslint.config.js`, with the reasoning beside it: every URL the shell builds is computed
and the rule only sees a literal `resolve()`. The Fractal model has the shell, the palette, the fact
sheet, the design system and the radar page as current, a new `inventory-shell` scene, and a
rewritten `decision-edit` journey; `fractal validate` is clean and the changed scenes are exported.

### Phase 5: providers as adapters and the host seam — td-c5dc7d

Depends on Phase 1. Independent of Phases 3 and 4.

- Provider manifests for `filesystem`, `git`, `loc`, `td`, `stack`, `github`, `endoflife`,
  `tech-signatures`. Scanner iterates enabled providers rather than a fixed sequence.
- Configuration file: TOML at `~/.config/ongoing/config.toml`, `--config` to point elsewhere, with
  a `[providers]` section; env vars remain overrides and `.env` keeps working for secrets.
  `ongoing providers` and `GET /api/providers`.
- Host adapter interface behind `serve`, `scan`, `restart`, `stop`, `logs`; `launchd` as the first
  implementation, `foreground` as the second.
- Deployment profile: aerie constants and the release scripts move to `deploy/aerie/`; the core
  never imports them.
- Website export becomes an export profile (`opentangle`), with a generic JSON export beside it.
- Second implementation of one seam as proof, whichever is cheapest: `foreground` host, or a
  `manifest` discovery provider that reads a list of paths.

Evidence: aerie runs with the same behaviour through the new wiring; a machine with no `td`, no
`cloc`, and no GitHub token runs a clean scan with those providers reported unavailable.

### Phase 6: inventory uses and open-source release — td-daa20f

Depends on Phases 2 through 5.

- Completeness per entry from `required` fields; `ongoing list 'complete<100'`; an attention
  reason for incomplete entries that carry `intent: invest`.
- Remote-only entries: the `github` provider can discover repositories in configured orgs that
  have no local checkout.
- Fleet sweeps as composition, not a feature: document `ongoing list 'tech:go stack.go<1.26'
--paths | xargs ...` patterns; add `ongoing each <query> -- <command>` only if the pattern
  proves painful.
- `ongoing init`, `ongoing serve`, single-binary spike with `bun build --compile`, Homebrew tap
  if the spike holds.
- License, README rewrite for a stranger, CI on GitHub Actions, removal of every remaining
  Marcus-specific string from the core, and only then the repository goes public. The repository
  stays private until the Phase 6 evidence below passes on a machine that is not aerie; publishing
  earlier behind a "not yet usable elsewhere" notice buys nothing and costs a support surface.

Evidence: a fresh macOS account installs, inits, scans a directory, and edits an entry from the
browser and the CLI, with no aerie or Marcus configuration present.

## Cross-cutting rules

- Every phase updates `docs/diagrams/fractal/` in the same change and passes `fractal validate`.
- Every phase ends committed and pushed to `main`, with td handoffs in this plan and in td.
- Migrations are additive within a phase and reversible by restoring the pre-phase backup.
- New capability order: domain function, repository method, API route, CLI verb, then UI.

## Resolved questions

Settled in Phase 0 on 2026-09-11. Reopen one only with a reason written down here.

- **Provider metric tables stay typed tables** behind the read model's namespaced projection.
  Moving them into per-provider JSON documents waits for a second hosting or issues provider.
- **`manual_rank` becomes an ordinary integer field** in `attributes`, still a sort key, with
  `reorder` as a palette and CLI command rather than a drag interaction.
- **Configuration is TOML with environment overrides**, since environment variables alone cannot
  express a provider list with per-provider settings.
- **`depends_on` is registered but unwritten until Phase 6 or later.** Phase 3 ships `uses` and
  `provides`; "provided by project X" answers the question that actually comes up today.
- **The repository goes public at the end of Phase 6**, once the fresh-machine evidence passes.
  No early publication behind a disclaimer.

## Changelog

- 2026-09-12: Phase 4 — the browser is the inventory: a rail, a table over chosen columns with an
  inline editor per registered field type, a detail panel on `Enter`, fact sheets at `/p/<slug>` and
  `/t/<slug>`, the radar page, a providers screen, and `Cmd+K`; dark-first LCH tokens and
  `src/lib/ui/` replace `dashboard.css`, the ticker, the flyout, the drawer, and drag reorder;
  the URL carries the same query string `ongoing list` sends, defaults included; edits are
  optimistic with undo, re-running the registry and the attention rules in the browser; and every
  browser mutation is proved against `bin/ongoing` in Playwright. `DESIGN.md` records the house
  style.
- 2026-09-12: Phase 3 — technologies are entries with rings, `uses` edges are detected inside the
  stack collector's pass or declared by hand, `ongoing tech list|show|add|set|seed|export` is the
  radar's surface, an `out` technology in use and a stale ring are attention reasons, and the
  `project-standards` skill's language and tool tables are generated from `ongoing tech export`.
  The tech radar companion moved to `implemented/`.
- 2026-09-11: proposal written from a conversation with Marcus. Nothing built.
- 2026-09-11: Phase 0 — decisions 1–5 and every open question settled, ADRs 0005–0008 written, the
  shipped dashboard plan moved to `implemented/`, the tech radar re-homed here as Phase 3's
  companion, six phase epics filed in td, and the Fractal proposal scene widened to the whole plan.
- 2026-09-11: Phase 2 — one query grammar reads the catalog: a pure parser and evaluator over the
  field registry, `GET /api/entries?q=&sort=&columns=&saved=` as the single read endpoint, `ongoing
list`, `views`, and `stacks` rewritten on it with every old flag kept as a clause alias, saved
  views shipped built in, and docs/cli.md rewritten around the grammar.
- 2026-09-11: Phase 1 — the catalog moved onto entries, a field registry, relations, and saved views;
  one validated patch path serves the API, the CLI, and the browser; `/api/entries`, `/api/fields`,
  `/api/relations`, and `/api/views` shipped with the CLI verbs over them; the production catalog
  migrates losslessly on a real copy; the existing dashboard runs unchanged on the new model.
