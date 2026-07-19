import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
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
    Object.keys(body).some((key) => key !== 'favorite') ||
    typeof (body as Record<string, unknown>).favorite !== 'boolean'
  )
    return json({ error: 'favorite must be a boolean' }, { status: 400 });
  const favorite = (body as { favorite: boolean }).favorite;
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    await catalogRepository.setFavorite(params.id, favorite);
    return json({ id: params.id, favorite });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update favorite';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 400 }
    );
  }
};
