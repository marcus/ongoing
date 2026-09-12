import { json } from '@sveltejs/kit';
import { EntryValidationError, type Entry } from '$lib/domain/entry';
import { FieldValidationError } from '$lib/domain/fields';
import { RelationValidationError } from '$lib/domain/relation';
import { SavedViewValidationError } from '$lib/domain/view';
import type { CatalogRepository } from '$lib/server/catalog/repository';

/** Shared request and error handling for the entry-shaped routes, so they all answer alike. */
export async function readObject(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Request body must be an object' }, { status: 400 });
    return body as Record<string, unknown>;
  } catch {
    return json({ error: 'Request body must be JSON' }, { status: 400 });
  }
}

const notFound = /^Unknown (entry|project|relation) ID:|^Unknown (saved view|user field):/;

/** Validation failures are the caller's fault (400); a missing row is a 404; the rest are 400. */
export function failure(error: unknown, fallback: string): Response {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof FieldValidationError ||
    error instanceof EntryValidationError ||
    error instanceof RelationValidationError ||
    error instanceof SavedViewValidationError
  )
    return json({ error: message }, { status: 400 });
  return json({ error: message }, { status: notFound.test(message) ? 404 : 400 });
}

/**
 * Resolves an entry reference: an id, a `kind/slug` pair, or a bare slug when it is unambiguous.
 * The CLI, the browser, and a script all name entries the same way because of this.
 */
export function resolveEntryRef(repository: CatalogRepository, reference: string): Entry {
  const direct = repository.getEntry(reference);
  if (direct) return direct;
  if (reference.includes('/')) {
    const [kind, slug] = reference.split('/', 2);
    const entry = repository.getEntryBySlug(kind, slug);
    if (entry) return entry;
  }
  const matches = repository
    .listEntries({ includeHidden: true })
    .filter((entry) => entry.slug === reference);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    throw new EntryValidationError(
      `"${reference}" is a slug in several kinds: ${matches.map((entry) => `${entry.kind}/${entry.slug}`).join(', ')}`
    );
  throw new Error(`Unknown entry ID: ${reference}`);
}
