import type { ProjectWebsite } from './website';

/**
 * The catalog holds **entries**, not projects. A project is an entry with `kind = 'project'`; a
 * technology is an entry with `kind = 'technology'`. Everything else about an entry — its decision
 * fields, its provider metrics, its relations — hangs off the registry rather than off a column,
 * so a new kind or a new field is a row rather than a migration (ADR 0005).
 */
export const entryKinds = ['project', 'technology'] as const;

export type EntryKind = (typeof entryKinds)[number];

export const ENTRY_NOTE_MAX_LENGTH = 500;
export const ENTRY_NAME_MAX_LENGTH = 200;
export const ENTRY_TAG_MAX_LENGTH = 60;
export const MAX_ENTRY_TAGS = 32;

export type AttributeValue = string | number | boolean | string[] | Record<string, unknown> | null;

export interface Entry {
  id: string;
  kind: string;
  slug: string;
  name: string;
  note: string;
  tags: string[];
  isFavorite: boolean;
  isHidden: boolean;
  /** Registered field values that do not live in a column. Never read with SQL JSON functions. */
  attributes: Record<string, AttributeValue>;
  reviewAfter: string | null;
  /**
   * Public-site metadata. It stays a column of its own rather than an attribute because the
   * website document has its own validator (`updateWebsite`) and becomes an export profile in
   * Phase 5; folding it into the registry now would buy nothing.
   */
  website: ProjectWebsite | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a provider found an entry. The filesystem provider writes `locator = canonical path`;
 * a hosting provider would write a repository URL. An entry may have several sources or none,
 * which is what makes a repository with no local checkout expressible at all.
 */
export interface EntrySource {
  entryId: string;
  provider: string;
  locator: string;
  /** Provider-specific context, e.g. the filesystem provider's scan root and relative path. */
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  /** When this source stopped finding the entry, and null whenever it is present. */
  missingSince: string | null;
}

export interface EntryInput {
  kind: string;
  name: string;
  slug?: string;
  note?: string;
  tags?: string[];
  attributes?: Record<string, AttributeValue>;
  reviewAfter?: string | null;
}

export class EntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryValidationError';
  }
}

/** `ongoing show td`, `/p/td`, `/t/sveltekit` — slugs are the human-typed handle for an entry. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'entry';
}

export function validateSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))
    throw new EntryValidationError(
      `Slug must be lowercase letters, digits, and hyphens: ${JSON.stringify(slug)}`
    );
}

/** Appends `-2`, `-3`, … until the slug is free within its kind. */
export function uniqueSlug(preferred: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(preferred)) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred.slice(0, 60)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new EntryValidationError('tags must be an array of strings');
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new EntryValidationError('tags must be an array of strings');
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > ENTRY_TAG_MAX_LENGTH)
      throw new EntryValidationError(`Tags may not exceed ${ENTRY_TAG_MAX_LENGTH} characters`);
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_ENTRY_TAGS)
    throw new EntryValidationError(`An entry may not carry more than ${MAX_ENTRY_TAGS} tags`);
  return tags.sort((left, right) => left.localeCompare(right, 'en'));
}
