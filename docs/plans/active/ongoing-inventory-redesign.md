# Ongoing as a software inventory

**Status:** proposal, for discussion. Nothing below is built. Decisions are marked _settled_ only where
the existing code or Marcus's standing principles already decide them; everything else is a lean.

Inputs: the running dashboard and its Fractal model (`docs/diagrams/fractal/`), the tech radar
sketch (`../tech-radar.md`), the project-standards brief
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

## Settled decisions

These follow from the existing ADRs and Marcus's design principles and are not up for re-discussion
here.

- App-owned storage, filesystem discovery authoritative for local projects (ADR 0001).
- Providers behind domain-owned interfaces; a provider failure never fails a scan (ADR 0002, 0003).
- One HTTP contract for browser and CLI; no UI-only capability (AGENTS.md, `surface-parity`).
- Pure domain rules with no I/O, so the browser can re-run them after an optimistic edit.
- No grand score. Attention views stay independent, transparent classifications.
- Auth stays disabled on aerie. The redesign does not touch the auth model.

## Decision 1: backend language

**Lean: stay on SvelteKit and Bun.** Revisit only if a trigger below fires.

What is actually being chosen is where the domain rules live and how the thing is distributed.

- The attention classifier, stack resolution, and soon the query parser run in both the server and
  the browser. One TypeScript module serves both. A Go backend would mean a second implementation
  of every rule in the browser, or giving up optimistic re-classification.
- One process serves the UI and the API. Go would split it into a Go service plus a separate
  frontend build, which is more to operate for no user-visible gain.
- Distribution is the honest argument for Go: a single binary and a Homebrew tap. Bun answers most
  of it with `bun build --compile`, which produces a single executable including the SvelteKit
  server, and a tap can ship that. This is unproven for this app and is a Phase 6 spike.
- The CLI today needs the service running. For an open-source user who wants `ongoing scan` and
  `ongoing list` with no daemon, the CLI should be able to link the core library in-process and
  fall back to HTTP when a service is present. That is a transport adapter, and it works in either
  language.

Triggers that would reopen this: the scanner needs to run on hosts without Bun; the browser stops
needing shared domain code; or a standalone `ongoing` binary under Bun turns out to be unreliable.

## Decision 2: the entry model

**Lean: one `entries` table with a `kind`, a typed field registry, JSON attributes, and a
`relations` table.** Provider-collected data stays in its own tables keyed by entry id.

What is being chosen: whether adding a field or a kind is a migration (today) or a row (proposed),
at the cost of moving nine well-typed project columns into a JSON document.

### Entries

| Column                                    | Notes                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `id`                                      | stable, as today                                                                        |
| `kind`                                    | `project`, `technology`, later others; registered like a field                          |
| `slug`                                    | unique per kind; what URLs and the CLI use (`ongoing show td`, `/p/td`, `/t/sveltekit`) |
| `name`                                    | display name                                                                            |
| `note`                                    | free text, as today                                                                     |
| `tags`                                    | JSON array of strings                                                                   |
| `is_favorite`, `is_hidden`, `manual_rank` | as today                                                                                |
| `attributes`                              | JSON object of registered field values                                                  |
| `review_after`                            | as today; kind-agnostic                                                                 |
| `created_at`, `updated_at`                |                                                                                         |

`intent`, `excitement`, `strategic_importance`, `next_action`, and the tech radar's `ring`,
`tool_surface`, and `technology_kind` all become registered fields living in `attributes`.

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
`td.open`, `stack.go`), so filtering and sorting treat them like any other field. Re-homing them
into per-provider documents is a later step inside Phase 5, if the provider seam needs it.

### Relations

`relations(id, from_id, to_id, kind, evidence, provider, attributes, note, created_at, updated_at)`,
unique on `(from_id, to_id, kind, evidence)`. Relation kinds are registered like fields with the
entry kinds they connect: `uses` (project → technology), `provides` (project → technology),
`depends_on` (project → project), `part_of` (project → project). `evidence` is `declared` or
`detected`; detected rows are rewritten by their provider on every scan and never edited by hand.

### Saved views

`saved_views(id, name, kind, query, columns, position)`. A query is the same string the CLI and URL
carry, so a saved view is a bookmark, not a second query language.

### Storage stance

Attributes as one JSON document per entry, filtered and sorted in the read model, keeps the store
interface to key, record, and simple scans. No JSON1 expressions in business logic. At the catalog's
size this is fast and it survives a move to JSONL, Postgres, or a document store unchanged.

## Decision 3: the query model

One grammar, parsed by a pure domain function, used by the API, the CLI, and the browser.

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

## Decision 4: provider seams

Every collector becomes a **provider** with a manifest. The manifest is what makes the seam real.

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

## Decision 5: frontend direction

**Start from `linear-design-patterns`, then drift into a house style on purpose.** The current
`dashboard.css` monolith and mockup-derived layout are replaced, not restyled.

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

### Phase 0: decisions and housekeeping

- Discuss and settle Decisions 1 through 5; rewrite this section as they settle.
- Write ADRs 0005 (entry model and field registry), 0006 (query model), 0007 (provider manifests
  and host adapters), 0008 (frontend design system).
- Move `docs/plans/ongoing-projects-dashboard.md` to `implemented/`; fold `tech-radar.md` into
  this plan or move it to `active/` as the radar's detailed model. Point td-c757bc and td-3a561b
  at this plan; file one td epic per phase.
- Update the Fractal model's proposed scene to describe this plan, not just the radar.

Evidence: ADRs merged, td epics filed, `fractal validate` clean.

### Phase 1: entry model, field registry, relations

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

### Phase 2: query model and CLI parity

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

### Phase 3: technologies and the radar

Depends on Phase 1. Runs alongside Phase 2 or 4.

- `technology` kind with fields `technology_kind`, `ring`, `tool_surface`, `review_after`;
  relation kinds `uses` and `provides`.
- Seed the six technologies from the radar sketch through the CLI, not a migration.
- `tech-signatures` provider: manifest-dependency signatures inside the stack collector's parse
  pass; languages read from `project_stacks`. Detected `uses` edges rewritten every scan.
- CLI: `ongoing tech list|show|add|set|export`, `ongoing show <project>` gains a uses section,
  `list 'tech:go'` works through the query model.
- Attention: an `out` technology in use, or a stale ring, is a reason in the existing views.
- `ongoing tech export --json` feeds the `project-standards` generator; the language and
  tool-surface tables in the skill become generated. Closes td-c757bc and td-3a561b.

Evidence: `ongoing tech show go` lists every Go project with versions; the skill regenerates from
the export with no hand edits.

### Phase 4: frontend redesign

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

### Phase 5: providers as adapters and the host seam

Depends on Phase 1. Independent of Phases 3 and 4.

- Provider manifests for `filesystem`, `git`, `loc`, `td`, `stack`, `github`, `endoflife`,
  `tech-signatures`. Scanner iterates enabled providers rather than a fixed sequence.
- Configuration file (`~/.config/ongoing/config.toml` or `.env`, one format) with an `[providers]`
  section; env vars remain overrides. `ongoing providers` and `GET /api/providers`.
- Host adapter interface behind `serve`, `scan`, `restart`, `stop`, `logs`; `launchd` as the first
  implementation, `foreground` as the second.
- Deployment profile: aerie constants and the release scripts move to `deploy/aerie/`; the core
  never imports them.
- Website export becomes an export profile (`opentangle`), with a generic JSON export beside it.
- Second implementation of one seam as proof, whichever is cheapest: `foreground` host, or a
  `manifest` discovery provider that reads a list of paths.

Evidence: aerie runs with the same behaviour through the new wiring; a machine with no `td`, no
`cloc`, and no GitHub token runs a clean scan with those providers reported unavailable.

### Phase 6: inventory uses and open-source release

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
- License, README rewrite for a stranger, CI on GitHub Actions, public repository, removal of
  every remaining Marcus-specific string from the core.

Evidence: a fresh macOS account installs, inits, scans a directory, and edits an entry from the
browser and the CLI, with no aerie or Marcus configuration present.

## Cross-cutting rules

- Every phase updates `docs/diagrams/fractal/` in the same change and passes `fractal validate`.
- Every phase ends committed and pushed to `main`, with td handoffs in this plan and in td.
- Migrations are additive within a phase and reversible by restoring the pre-phase backup.
- New capability order: domain function, repository method, API route, CLI verb, then UI.

## Open questions

- Should provider metric tables move into per-provider JSON documents in Phase 5, or stay as
  typed tables behind the projection? Lean: stay, until a second hosting or issues provider exists.
- Does `manual_rank` survive as a core column or become an ordinary integer field? Lean: field,
  with `reorder` as a palette and CLI command over it.
- One config file format for the open-source install: TOML, JSON, or keep env only? Lean: TOML
  with env overrides, since env alone does not express provider lists well.
- Is `depends_on` between projects wanted in Phase 3, or is `provides` enough until a real
  "what breaks if I retire comms" question arrives? Lean: `provides` only.
- Public repository timing: at Phase 6, or earlier with a "not yet usable elsewhere" notice?

## Changelog

- 2026-09-11: proposal written from a conversation with Marcus. Nothing built.
