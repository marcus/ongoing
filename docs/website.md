# Public website catalog

Ongoing owns the public project copy used by OpenTangle. Each project has an optional `website` record, independent of its private note, scan data, and dashboard visibility. New metadata defaults to `included: false`. Eligibility also requires a verified public GitHub repository, or an explicit public-website override for a private or unverified repository. An inclusion change does not deploy anything.

## Edit through the CLI or API

```sh
ongoing website sidecar                         # JSON metadata, or null if unconfigured
ongoing website sidecar --file public-copy.json # patch public copy; first record defaults to draft
ongoing website sidecar --include               # select for the next site build
ongoing website sidecar --exclude               # omit from the next site build; retain the draft
ongoing website braid --allow-private          # explicit public-facing site exception; requires a non-GitHub URL
ongoing website braid --public-repo-only       # restore the default repository policy
ongoing website pages                          # managed pages without local repositories
ongoing website page greatway --file page.json # create or patch a standalone draft
ongoing website export                         # deterministic JSON of explicitly included projects
ongoing website export --drafts                # all configured copy, marked as a draft export
```

`--url`, `ONGOING_URL`, and authentication work as for the existing CLI. `website` always prints JSON. The installed `ongoing` wrapper runs this repository's CLI source with the pinned Bun runtime. The HTTP service must be rebuilt and restarted to expose new endpoints.

The first metadata file requires the fields below; later requests can patch any subset. Text is plain, nonempty, single-line text without HTML. Slugs are unique across configured projects and cannot be `about`. HTTP(S) URLs cannot contain credentials. Artwork IDs are positive photo numbers or stable lowercase string keys referring to assets in the website's own manifest; the website build verifies that the derivative exists.

```json
{
  "included": false,
  "allowPrivateRepository": false,
  "slug": "example",
  "name": "Example",
  "tagline": "A short public summary.",
  "description": "The longer description printed on the reverse.",
  "category": "Developer Tool",
  "year": "2026",
  "stack": "Go • SQLite",
  "url": "https://example.com/",
  "status": "Active",
  "order": 0,
  "artworkId": 146
}
```

`allowPrivateRepository` defaults to false. It permits a private/unknown repository only when the explicit public URL points to a distinct website, not github.com or its raw content host. Repository visibility comes from Ongoing's existing GitHub collector; do not infer it from the destination URL. `ongoing website <project>` reports the cached visibility and eligibility/reason. Refresh a stale repository scan before publication.

`order` is a non-negative integer and defaults to zero. Exports sort by order then slug. Text limits are slug 80, name 100, tagline 400, description 2000, category 80, stack 180, URL 1000, and status 100 characters; year is four digits. Public copy never defaults to private notes, repository names, paths, or scanned GitHub metadata.

| Endpoint                          | Contract                                              |
| --------------------------------- | ----------------------------------------------------- |
| `GET /api/projects/:id/website`   | `{ id, website }`; `website` may be null              |
| `PATCH /api/projects/:id/website` | Validated partial metadata; returns `{ id, website }` |
| `GET /api/website`                | Version 1 eligible live catalog, possibly empty       |
| `GET /api/website?drafts=true`    | Version 1 draft catalog of all configured records     |

Standalone pages use `GET /api/website/pages` and `GET/PATCH /api/website/pages/:slug`. They share the same metadata, slug uniqueness, selection, override, and export rules as repository-backed projects. They require an explicit public-website override because no repository visibility exists. They live in `website_pages`, have no fabricated filesystem path, and are unaffected by repository scans or missing-directory cleanup. Disable them with `ongoing website page <slug> --exclude`.

The export includes only `id` (the public slug), name, tagline, description, category, year, stack, URL, status, and artwork ID. It omits internal project IDs, paths, notes, metrics, inclusion flags, and timestamps. Its envelope is `{ schemaVersion: 1, source: "ongoing", mode: "live" | "draft", projects: [...] }`. An unchanged selection produces the same output regardless of dashboard sorting or scan timestamps.

Dashboard hidden/missing flags do not change explicit website selection. Scanning preserves website metadata. Forgetting a project removes its metadata with the project, so review the website export before deploying after catalog cleanup.

## Migration and the OpenTangle draft deck

Migration 5 adds nullable `website_json`; existing projects acquire no metadata or inclusion flag. It runs through the normal catalog migration path. No existing project is automatically selected.

Migration 6 adds an initially empty `website_pages` table for standalone pages. Both migrations are additive and run through the existing catalog lifecycle.

OpenTangle keeps its curated design preview in `public/data/projects.json`, marked `source: "preview", mode: "draft"`. Its `data/website-drafts.json` and `scripts/seed-website-drafts.mjs` prepare fifteen repository records and four standalone pages as drafts through this API. Seeding defaults to a read-only plan, skips retired candidates, and preserves existing website metadata, including explicit inclusion choices. See OpenTangle's `docs/catalog.md` for the next-deployment workflow.
