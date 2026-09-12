import { json } from '@sveltejs/kit';
import { entryKinds, type AttributeValue } from '$lib/domain/entry';
import { QueryError } from '$lib/domain/query';
import { isEntriesPageError, readEntriesPage } from '$lib/server/api/entries';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

/**
 * The inventory, as entries, read through one query grammar (ADR 0006). `?q=` filters, `?sort=`
 * orders, `?columns=` says what a caller intends to render, and `?saved=` prepends a saved view's
 * query. The pre-Phase-2 parameters — `view`, `filter`, `stack`, `search`, `kind`, `dir` — are
 * translated into clauses by `legacyParamsToQuery` and keep working for one release; the
 * translation table is documented in docs/cli.md and asserted by the tests.
 *
 * The reading itself lives in `readEntriesPage`, which the CLI's in-process transport also calls.
 */
export const GET: RequestHandler = async ({ url }) => {
  let catalogRepository;
  try {
    ({ catalogRepository } = await import('$lib/server/scanning/runtime'));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'The catalog could not be opened' },
      { status: 503 }
    );
  }

  try {
    const page = readEntriesPage(catalogRepository, (name) => url.searchParams.get(name));
    return isEntriesPageError(page)
      ? json({ error: page.error }, { status: page.status })
      : json(page);
  } catch (error) {
    if (error instanceof QueryError) return json({ error: error.message }, { status: 400 });
    return json(
      { error: error instanceof Error ? error.message : 'The catalog could not be read' },
      { status: 503 }
    );
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const { readEntryView } = await import('$lib/server/catalog/entries');
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!entryKinds.includes(kind as (typeof entryKinds)[number]))
    return json({ error: `kind must be one of ${entryKinds.join(', ')}` }, { status: 400 });
  if (kind === 'project')
    return json(
      { error: 'Projects are discovered, not created — run a scan over their directory' },
      { status: 400 }
    );
  if (typeof body.name !== 'string' || !body.name.trim())
    return json({ error: 'name is required' }, { status: 400 });
  const reserved = new Set(['kind', 'name', 'slug']);
  try {
    const entry = await catalogRepository.createEntry({
      kind,
      name: body.name,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      attributes: Object.fromEntries(
        Object.entries(body).filter(([key]) => !reserved.has(key))
      ) as Record<string, AttributeValue>
    });
    return json(readEntryView(catalogRepository, entry), { status: 201 });
  } catch (error) {
    return failure(error, 'Unable to create entry');
  }
};
