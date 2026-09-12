import type { Database } from 'bun:sqlite';
import type { AttributeValue } from '$lib/domain/entry';
import { slugify, uniqueSlug } from '$lib/domain/entry';

interface ProjectRow {
  id: string;
  canonical_path: string;
  relative_path: string;
  name: string;
  scan_root: string;
  is_favorite: number;
  is_hidden: number;
  manual_rank: number;
  note: string;
  intent: string | null;
  excitement: number | null;
  strategic_importance: number | null;
  next_action: string | null;
  review_after: string | null;
  is_missing: number;
  missing_since: string | null;
  website_json: string | null;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

/**
 * Moves every project row into `entries` + `entry_sources`, in place and losslessly.
 *
 * Ids are preserved, so the metric tables re-key to the same values in migration 008. Decision
 * columns become registered attributes; the discovery columns become the filesystem provider's
 * source row, with `locator = canonical path`. Slugs are generated here rather than in SQL because
 * they have to be de-duplicated across the catalog.
 */
export function migrateProjectsIntoEntries(database: Database): void {
  const projects = database
    .query<ProjectRow, []>('SELECT * FROM projects ORDER BY manual_rank, name, id')
    .all();
  if (projects.length === 0) return;

  const insertEntry = database.query(
    `INSERT INTO entries (
       id, kind, slug, name, note, tags, is_favorite, is_hidden, attributes, review_after,
       website_json, created_at, updated_at
     ) VALUES (?, 'project', ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertSource = database.query(
    `INSERT INTO entry_sources (
       entry_id, provider, locator, metadata, first_seen_at, last_seen_at, missing_since
     ) VALUES (?, 'filesystem', ?, ?, ?, ?, ?)`
  );

  const taken = new Set<string>();
  for (const project of projects) {
    const slug = uniqueSlug(slugify(project.name), taken);
    taken.add(slug);

    const attributes: Record<string, AttributeValue> = { manual_rank: project.manual_rank };
    if (project.intent !== null) attributes.intent = project.intent;
    if (project.excitement !== null) attributes.excitement = project.excitement;
    if (project.strategic_importance !== null)
      attributes.strategic_importance = project.strategic_importance;
    if (project.next_action !== null) attributes.next_action = project.next_action;

    insertEntry.run(
      project.id,
      slug,
      project.name,
      project.note,
      project.is_favorite,
      project.is_hidden,
      JSON.stringify(attributes),
      project.review_after,
      project.website_json,
      project.first_seen_at,
      project.updated_at
    );
    insertSource.run(
      project.id,
      project.canonical_path,
      JSON.stringify({ relativePath: project.relative_path, scanRoot: project.scan_root }),
      project.first_seen_at,
      project.last_seen_at,
      // is_missing and missing_since collapse into one column: a source is missing exactly while it
      // has a start time. Migration 004 stamped pre-existing missing rows, but a row that predates
      // it and was never touched since would still be null, so fall back to updated_at.
      project.is_missing === 1 ? (project.missing_since ?? project.updated_at) : null
    );
  }
}
