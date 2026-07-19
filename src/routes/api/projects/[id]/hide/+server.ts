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
    Object.keys(body).some((key) => key !== 'hidden') ||
    typeof (body as Record<string, unknown>).hidden !== 'boolean'
  )
    return json({ error: 'hidden must be a boolean' }, { status: 400 });
  const hidden = (body as { hidden: boolean }).hidden;
  try {
    const { catalogRepository, scheduleProjectEnrichment } =
      await import('$lib/server/scanning/runtime');
    await catalogRepository.setHidden(params.id, hidden);
    if (!hidden) scheduleProjectEnrichment(params.id);
    return json({ id: params.id, hidden });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update hidden state';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 400 }
    );
  }
};
