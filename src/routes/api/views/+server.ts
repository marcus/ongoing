import { json } from '@sveltejs/kit';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

/** Saved views: a stored query plus columns, named. The query string is Phase 2's grammar. */
export const GET: RequestHandler = async () => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  return json({ views: catalogRepository.listSavedViews() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  try {
    return json(await catalogRepository.saveView(body as never), { status: 201 });
  } catch (error) {
    return failure(error, 'Unable to save view');
  }
};

/** Renaming is not supported: a view is addressed by name, so PATCH changes what it selects. */
export const PATCH: RequestHandler = async ({ url, request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const name = url.searchParams.get('view') ?? (body.name as string | undefined) ?? '';
  const existing = name ? catalogRepository.getSavedView(name) : null;
  if (!existing) return json({ error: `Unknown saved view: ${name}` }, { status: 404 });
  try {
    return json(
      await catalogRepository.saveView({
        name: existing.name,
        kind: (body.kind as string | null | undefined) ?? existing.kind,
        query: (body.query as string | undefined) ?? existing.query,
        columns: (body.columns as string[] | undefined) ?? existing.columns,
        position: (body.position as number | undefined) ?? existing.position
      })
    );
  } catch (error) {
    return failure(error, 'Unable to update view');
  }
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  let name = url.searchParams.get('view') ?? '';
  if (!name) {
    const body = await readObject(request);
    if (body instanceof Response) return body;
    name = (body.name as string | undefined) ?? (body.id as string | undefined) ?? '';
  }
  if (!name) return json({ error: 'A view name is required' }, { status: 400 });
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  try {
    await catalogRepository.deleteSavedView(name);
    return json({ view: name, removed: true });
  } catch (error) {
    return failure(error, 'Unable to delete view');
  }
};
