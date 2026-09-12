import { json } from '@sveltejs/kit';
import { describeField, fieldAppliesTo } from '$lib/domain/fields';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

/** The field registry: built-in fields, provider fields, and the user's own. */
export const GET: RequestHandler = async ({ url }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const kind = url.searchParams.get('kind');
  const fields = catalogRepository
    .registry()
    .fields.filter((field) => !kind || fieldAppliesTo(field, kind))
    .map(describeField);
  return json({ fields });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  try {
    return json(describeField(await catalogRepository.addUserField(body)), { status: 201 });
  } catch (error) {
    return failure(error, 'Unable to register field');
  }
};

/** Removing a user field removes its stored values too; nothing keeps an unexplained attribute. */
export const DELETE: RequestHandler = async ({ url, request }) => {
  let key = url.searchParams.get('key') ?? '';
  if (!key) {
    const body = await readObject(request);
    if (body instanceof Response) return body;
    key = typeof body.key === 'string' ? body.key : '';
  }
  if (!key) return json({ error: 'A field key is required' }, { status: 400 });
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  try {
    await catalogRepository.removeUserField(key);
    return json({ key, removed: true });
  } catch (error) {
    return failure(error, 'Unable to remove field');
  }
};
