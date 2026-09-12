import { json } from '@sveltejs/kit';
import { entryKinds, type AttributeValue } from '$lib/domain/entry';
import { describeField } from '$lib/domain/fields';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

/**
 * The inventory, as entries. Phase 2 adds the query grammar (`?q=`, `?sort=`, `?columns=`);
 * for now the parameters are the two the catalog has always needed.
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    const { readEntryViews } = await import('$lib/server/catalog/entries');
    const kind = url.searchParams.get('kind') ?? undefined;
    const includeHidden = url.searchParams.get('hidden') !== 'false';
    const entries = readEntryViews(catalogRepository, { kind, includeHidden });
    return json({
      entries,
      total: entries.length,
      fields: catalogRepository
        .registry()
        .fields.filter((field) => !kind || field.kinds.includes('*') || field.kinds.includes(kind))
        .map(describeField),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'The catalog could not be opened' },
      { status: 503 }
    );
  }
};

/**
 * Creates an entry that no provider discovered — a technology, or anything else a person catalogs
 * by hand. Discovery still owns projects: a project entry gets its filesystem source from a scan,
 * so creating one here would be an entry with nowhere to point.
 */
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
