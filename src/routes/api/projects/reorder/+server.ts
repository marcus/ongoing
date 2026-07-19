import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'orderedIds')
  )
    return json({ error: 'Request body must contain only orderedIds' }, { status: 400 });
  const orderedIds = (body as Record<string, unknown>).orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string' || !id))
    return json({ error: 'orderedIds must be an array of non-empty project IDs' }, { status: 400 });
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    await catalogRepository.reorderVisibleProjects(orderedIds);
    return json({ orderedIds });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to reorder projects' },
      { status: 400 }
    );
  }
};
