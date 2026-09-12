import type { AttributeValue } from './entry';
import { fieldAppliesTo, type FieldRegistry } from './fields';

/**
 * Completeness per entry (Phase 6).
 *
 * A field definition already declares whether it is `required` for its kinds; completeness is
 * nothing more than counting how many of those an entry actually carries. It is a pure function
 * over the registry and the entry's flat `fields` map, so the read model, the CLI, and the browser
 * after an optimistic edit all get the same number without asking the server.
 *
 * The score is projected as the `complete` field, which makes `ongoing list 'complete<100'` an
 * ordinary query rather than a second concept.
 */
export interface Completeness {
  /** 0–100, rounded. An entry whose kind requires nothing is complete. */
  complete: number;
  /** The required field keys for this kind, in registry order. */
  required: string[];
  /** The required keys this entry has no value for. */
  missing: string[];
}

/**
 * "Has a value" as every surface means it: null, undefined, the empty string, and the empty list
 * are all absences. `false` and `0` are values — a boolean that was decided is not a blank.
 */
export function fieldHasValue(value: AttributeValue | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

/**
 * The column-backed values an entry carries, keyed the way the registry keys them. Completeness
 * reads stored values only — every `required` field is a column or an attribute, never a provider
 * projection — so this plus `attributes` is the whole input, on the server and in the browser.
 */
export function storedFields(entry: {
  kind: string;
  name: string;
  slug: string;
  note: string;
  tags: string[];
  isFavorite: boolean;
  isHidden: boolean;
  reviewAfter: string | null;
}): Record<string, AttributeValue> {
  return {
    kind: entry.kind,
    name: entry.name,
    slug: entry.slug,
    note: entry.note,
    tags: entry.tags,
    is_favorite: entry.isFavorite,
    is_hidden: entry.isHidden,
    review_after: entry.reviewAfter
  };
}

export function entryCompleteness(
  registry: FieldRegistry,
  kind: string,
  fields: Record<string, AttributeValue>
): Completeness {
  const required = registry.fields
    .filter((field) => field.required && fieldAppliesTo(field, kind))
    .map((field) => field.key);
  const missing = required.filter((key) => !fieldHasValue(fields[key]));
  return {
    complete: required.length
      ? Math.round(((required.length - missing.length) / required.length) * 100)
      : 100,
    required,
    missing
  };
}

/** The registered labels behind a list of keys, for a message a person reads. */
export function describeMissing(registry: FieldRegistry, missing: readonly string[]): string {
  return missing.map((key) => registry.get(key)?.label ?? key).join(', ');
}
