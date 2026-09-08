# Tech radar: technologies as catalog entries

**Status:** sketch. Not scheduled. Written so the idea has a home; nothing below is built.

## Summary

Ongoing catalogs projects. This adds a second kind of entry, **technologies**, and the edges between them: which projects use Go 1.27, which use SvelteKit, which are wired to Google authentication, which lean on Tailwind. On top of the edges sits a **radar**: Marcus's current temperature on each technology, so the catalog can answer "what are we into right now, and where is that already in use" without anyone keeping a spreadsheet.

The point is a lightweight dependency view, not an enterprise architecture tool. Detection does most of the upkeep. Marcus's only recurring input is a ring per technology, and the catalog nags when a ring is stale the same way it nags about `reviewAfter` today.

## Goals

- Record technologies as first-class catalog entries with a kind, a ring, and a note.
- Derive project-to-technology edges from repository manifests wherever possible; allow manual edges where detection cannot see (a configured OAuth provider, a hosted service).
- Answer, from CLI and JSON, "which projects use X", "what does project Y depend on", and "what is hot / warm / cool right now".
- Feed the `project-standards` skill: the language table and the tool-surface table become generated views of the radar rather than hand-maintained prose.
- Stay cheap. A technology that nobody declared interest in and no detector recognises does not exist to Ongoing.

## Non-goals

- A full dependency graph of every npm and Go module across every repo. Edges exist only for technologies in the catalog.
- Project-to-project dependency modelling beyond what falls out of "technology X is provided by managed project Y".
- Scoring, portfolio management, LeanIX-style lifecycle stages, or cost tracking.
- Replacing `stacks`. Toolchain declarations and upstream release baselines stay as they are; the radar reads them.

## Model

### Technology

| Field | Meaning |
|---|---|
| `id` | slug, e.g. `go`, `sveltekit`, `google-auth`, `sqlite`, `td` |
| `name` | display name |
| `kind` | `language`, `framework`, `library`, `service`, `tool`, `platform` |
| `ring` | `hot`, `warm`, `cool`, `out` (see below) |
| `note` | one line: why the ring, what it is for |
| `providedByProjectId` | optional; set when the technology *is* a managed project (`td`, `sidecar`, `comms`, `roc`) |
| `toolSurface` | optional one-liner; when set, this row appears in the `project-standards` tool table |
| `reviewAfter` | date after which the ring counts as stale |
| `updatedAt` | |

`providedByProjectId` is what lets "external tools instead of just projects" and "our own tools" share one table. `comms` is a project in the catalog and a technology other projects depend on. `td-c757bc` (a per-project tool-surface flag) collapses into `toolSurface` here: the flag belongs to the technology, not the project.

### Ring

Marcus's vocabulary, not ThoughtWorks'. Four values, ordered:

| Ring | Meaning |
|---|---|
| `hot` | Default choice for new work in its kind. Go, SvelteKit, SQLite today. |
| `warm` | Fine to keep using, not the default. Ruby for quick things. |
| `cool` | Use only with a reason; expect to migrate off eventually. Python. |
| `out` | Do not start new work on it. Flagged wherever it is still in use. |

A ring is a fact about now, so every ring carries `reviewAfter`. A stale ring is an attention reason, like a stale `reviewAfter` on a project.

### Usage edge

| Field | Meaning |
|---|---|
| `projectId`, `technologyId` | |
| `evidence` | `detected` or `declared` |
| `sourceFile` | manifest the detector matched, when detected |
| `version` | declared version or range, when the manifest carries one |
| `note` | optional, for declared edges: where the integration lives |

Detected edges are rewritten on every scan and never edited by hand. Declared edges are written by `ongoing tech link` and survive scans. The same pair can hold both; the resolved view prefers detected evidence and keeps the declared note.

## Detection

Extend the existing stack collector (`src/lib/server/collectors/stack.ts`) rather than adding a second scanner. It already parses `go.mod`, `package.json`, `.tool-versions`, `Cargo.toml`, `Gemfile`, `pyproject.toml`. The new step reads *dependencies* from those manifests and matches them against a **signature list** keyed by technology id:

```
sveltekit:    package.json deps  @sveltejs/kit
tailwind:     package.json deps  tailwindcss
google-auth:  package.json deps  google-auth-library | googleapis ; go.mod  golang.org/x/oauth2/google
sqlite:       go.mod  modernc.org/sqlite | mattn/go-sqlite3 ; package.json  better-sqlite3 | bun:sqlite (source grep)
td:           .todos/ directory present
```

Rules that keep this from ballooning:

- A signature exists only for a technology already in the catalog. Adding a technology means writing its signature; a dependency with no signature is invisible.
- Signatures live in one table in source, next to the toolchain table, and are the whole detector. No plugin system.
- Languages come for free: `project_stacks` already says `go 1.27.0`. The radar reads that table for `kind = language` rather than storing the edge twice.

Things detection will not see, and where a declared edge is the answer: a hosted service reached only through environment variables, an integration configured in a dashboard, a technology used in a repo Ongoing does not scan.

## Surfaces

CLI first, then JSON, then the web page.

```
ongoing tech list [--ring hot|warm|cool|out] [--kind ...] [--stale] [--json]
ongoing tech show <id>                  ring, note, every project using it, versions, evidence
ongoing tech add <id> --kind K --ring R [--note ...] [--provided-by <project>] [--tool-surface "..."]
ongoing tech set <id> [--ring R] [--note ...] [--review-after DATE] [--tool-surface "..."|none]
ongoing tech link <project> <tech> [--note ...]     declared edge
ongoing tech unlink <project> <tech>
ongoing tech export --json               technologies + edges, deterministic, for generators
ongoing show <project>                   gains a "uses" section
ongoing list --tech <id>                 projects using a technology
```

Web: one radar page, four rings as rows, each technology a chip with its project count; click through to the project list filtered by that technology. Reuse the existing list, no new visual language.

Attention: a project using an `out` technology, or a technology whose ring is past `reviewAfter`, produces an attention reason in the existing views. No new view.

## Consumers

- **`project-standards` skill** (marcus-skills). The language table is `tech list --kind language` ordered by ring; the tool-surface table is every technology with `toolSurface` set. A generator renders both between marker comments. Until this plan is built, both tables stay hand-written; the brief in clara-home (`docs/plans/active/agentic-sdlc-project-standards.md`) records that intent.
- **Fleet sweeps.** "Every project on Go < 1.26" or "every project still on `out` technology X" is a `tech show` or `list --tech` away, which is the query a security or upgrade sweep starts from.
- **Recall.** `tech export --json` is a natural additional source.

## Steel thread

The smallest version that proves the shape:

1. Migration: `technologies` and `project_technologies` tables.
2. Seed six technologies by hand: `go`, `sveltekit`, `sqlite`, `google-auth`, `tailwind`, `td`, with rings.
3. Signature detection for those six inside the existing stack collector; languages read from `project_stacks`.
4. `ongoing tech list`, `tech show`, `tech set --ring`, `tech link`, `tech export --json`.
5. `ongoing show <project>` prints the uses section.

Stop there and live with it for a few weeks. The web page, attention reasons, the skill generator, and `toolSurface` follow only if the CLI view gets used.

## Open questions

- Is `providedByProjectId` enough project-to-project modelling, or does the first real question ("what breaks if I retire comms") need explicit project-to-project edges? Lean: enough for now.
- Do languages get rings at all, or does the existing `stacks` upgrade pressure cover what matters for them? Lean: rings, because "Python is cool" is a preference that release baselines cannot express.
- Version-aware edges: is "uses Go" enough, or does the radar need "Go 1.27 vs 1.24" as separate concerns? Lean: store the version on the edge, ring the technology, and let `tech show` group by version.
- Where signatures that need a source grep (bun:sqlite) stop being worth it. Lean: manifest-only in the steel thread.

## Changelog

- 2026-09-07: sketch written from a conversation with Marcus. Nothing built.
