import { json } from '@sveltejs/kit';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const { readEntryView } = await import('$lib/server/catalog/entries');
  const entry = catalogRepository.getEntryBySlug(params.kind, params.slug);
  if (!entry)
    return json({ error: `Unknown entry: ${params.kind}/${params.slug}` }, { status: 404 });
  return json(readEntryView(catalogRepository, entry));
};

/**
 * The one write path for entry values. The body is a flat map of field key to value — `intent`,
 * `note`, `x.customer` — and `validateEntryPatch` decides what is allowed, so the CLI, the browser,
 * and a curl all get the same answer to the same patch.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const { readEntryView } = await import('$lib/server/catalog/entries');
  const entry = catalogRepository.getEntryBySlug(params.kind, params.slug);
  if (!entry)
    return json({ error: `Unknown entry: ${params.kind}/${params.slug}` }, { status: 404 });
  try {
    const updated = await catalogRepository.patchEntry(entry.id, body);
    return json(readEntryView(catalogRepository, updated));
  } catch (error) {
    return failure(error, 'Unable to update entry');
  }
};

/**
 * Removes an entry that was created by hand. Projects are removed by `ongoing forget`, which is
 * the path that knows about running scans and the missing-directory grace period.
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const entry = catalogRepository.getEntryBySlug(params.kind, params.slug);
  if (!entry)
    return json({ error: `Unknown entry: ${params.kind}/${params.slug}` }, { status: 404 });
  if (entry.kind === 'project')
    return json(
      { error: 'Projects are forgotten through /api/projects, which guards a running scan' },
      { status: 400 }
    );
  try {
    await catalogRepository.deleteEntry(entry.id);
    return json({ entry: `${entry.kind}/${entry.slug}`, removed: true });
  } catch (error) {
    return failure(error, 'Unable to remove entry');
  }
};
