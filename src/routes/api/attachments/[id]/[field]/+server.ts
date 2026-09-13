import { json } from '@sveltejs/kit';
import { readObject } from '$lib/server/api/support';
import { attachmentError } from '$lib/server/attachments';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { attachmentService } = await import('$lib/server/scanning/runtime');
    return json(await attachmentService.get(params.id, params.field));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read attachment';
    return json({ error: message }, { status: message.startsWith('Unknown project') ? 404 : 400 });
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  try {
    const { attachmentService } = await import('$lib/server/scanning/runtime');
    const expected =
      body.expected === null || body.expected === undefined ? null : String(body.expected);
    const result = await attachmentService.set(params.id, params.field, body.bundle, expected);
    const current = await attachmentService.get(params.id, params.field);
    return json({ ...result, document: current.document });
  } catch (error) {
    const failure = attachmentError(error);
    return json(failure.body, { status: failure.status });
  }
};
