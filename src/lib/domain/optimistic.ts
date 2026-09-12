import { attentionViewKeys, classifyAttentionViews } from './attention';
import type { AttributeValue } from './entry';
import type { EntryView } from './entry-view';
import { validateEntryPatch, type FieldRegistry } from './fields';
import type { ProjectIntent } from './project';

/**
 * Optimistic editing, as pure functions.
 *
 * The browser applies a patch locally and re-runs the same rules the server will run — the field
 * registry's validation and the attention classification — so a row moves out of `view:attention`
 * the instant its intent changes rather than a round trip later (ADR 0008). If the server refuses,
 * the caller restores the entry it kept and nothing has to be recomputed.
 */

/** Column-backed fields, and the property each one sets on an {@link EntryView}. */
const COLUMN_PROPERTIES: Readonly<Record<string, keyof EntryView>> = {
  name: 'name',
  slug: 'slug',
  note: 'note',
  tags: 'tags',
  is_favorite: 'isFavorite',
  is_hidden: 'isHidden',
  review_after: 'reviewAfter'
};

/** The empty value a cleared column falls back to, matching what the repository stores. */
const COLUMN_EMPTY: Readonly<Record<string, AttributeValue>> = {
  note: '',
  tags: [],
  is_favorite: false,
  is_hidden: false,
  review_after: null
};

/**
 * Re-classify a project after a local edit. Everything the rules read — the metric row, the
 * resolved stacks, the collector errors, the technologies behind its `uses` edges — already
 * travels on the entry, so this needs no I/O and gives the same answer the server will.
 */
export function reclassify(entry: EntryView, now = Date.now()): EntryView {
  if (entry.kind !== 'project') return entry;
  const attention = classifyAttentionViews(
    {
      id: entry.id,
      isMissing: entry.isMissing,
      intent: (entry.attributes.intent ?? null) as ProjectIntent | null,
      metrics: entry.metrics,
      stacks: entry.stacks,
      errors: entry.errors,
      technologies: entry.technologies,
      githubStarsGained30d: numberField(entry, 'github.starsGained30d'),
      githubTrafficViewsDelta30d: numberField(entry, 'github.trafficViewsDelta30d'),
      githubTrafficClonesDelta30d: null
    },
    now
  );
  const views = attentionViewKeys.filter((key) => attention[key].member);
  const fields = { ...entry.fields };
  if (views.length) fields.views = [...views];
  else delete fields.views;
  return { ...entry, attention, views: [...views], fields };
}

function numberField(entry: EntryView, key: string): number | null {
  const value = entry.fields[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Apply a patch to an entry the way the server would. Throws `FieldValidationError` for anything
 * the registry refuses, which is what lets the browser show the CLI's error text before it sends.
 */
export function applyPatch(
  entry: EntryView,
  patch: Record<string, unknown>,
  registry: FieldRegistry,
  now = Date.now()
): EntryView {
  const validated = validateEntryPatch(registry, entry.kind, patch);
  const next: EntryView = {
    ...entry,
    attributes: { ...entry.attributes },
    fields: { ...entry.fields },
    tags: [...entry.tags]
  };

  for (const [column, raw] of Object.entries(validated.columns)) {
    const value = raw === null && column in COLUMN_EMPTY ? COLUMN_EMPTY[column] : raw;
    const property = COLUMN_PROPERTIES[column];
    if (property) Object.assign(next, { [property]: value });
    next.fields[column] = value;
  }
  for (const [key, value] of Object.entries(validated.attributes)) {
    if (value === null) {
      delete next.attributes[key];
      delete next.fields[key];
    } else {
      next.attributes[key] = value;
      next.fields[key] = value;
    }
  }
  return reclassify(next, now);
}

/**
 * The patch that puts an entry back. Undo is a patch like any other, so it goes through the same
 * validation, the same endpoint, and the same CLI verb as the edit it reverses.
 */
export function inversePatch(
  entry: EntryView,
  patch: Record<string, unknown>
): Record<string, AttributeValue> {
  const inverse: Record<string, AttributeValue> = {};
  for (const key of Object.keys(patch)) {
    const current = entry.fields[key];
    inverse[key] = current === undefined ? null : current;
  }
  return inverse;
}
