import { json } from '@sveltejs/kit';
import {
  PROJECT_NOTE_MAX_LENGTH,
  projectIntents,
  validateDecisionUpdate,
  type ProjectDecisionUpdate
} from '$lib/domain/project';
import { localProjectActions, runProjectAction } from '$lib/server/projects/actions';
import type { RequestHandler } from './$types';

async function requestObject(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'Request body must be an object' }, { status: 400 });
    return body as Record<string, unknown>;
  } catch {
    return json({ error: 'Request body must be JSON' }, { status: 400 });
  }
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await requestObject(request);
  if (body instanceof Response) return body;
  const allowed = [
    'note',
    'intent',
    'excitement',
    'strategicImportance',
    'nextAction',
    'reviewAfter'
  ];
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key)))
    return json({ error: 'Request contains unsupported project fields' }, { status: 400 });
  if (body.note !== undefined && typeof body.note !== 'string')
    return json({ error: 'note must be a string' }, { status: 400 });
  if (typeof body.note === 'string' && body.note.length > PROJECT_NOTE_MAX_LENGTH)
    return json(
      { error: `note must not exceed ${PROJECT_NOTE_MAX_LENGTH} characters` },
      { status: 400 }
    );
  const decision = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'note')
  ) as ProjectDecisionUpdate;
  if (
    decision.intent !== undefined &&
    decision.intent !== null &&
    (typeof decision.intent !== 'string' || !projectIntents.includes(decision.intent as never))
  )
    return json(
      { error: `intent must be one of ${projectIntents.join(', ')}, or null` },
      { status: 400 }
    );
  try {
    validateDecisionUpdate(decision);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Invalid decision fields' },
      { status: 400 }
    );
  }
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    // The URL ID is the only project selector accepted; browser payloads never carry paths.
    if (typeof body.note === 'string') await catalogRepository.updateNote(params.id, body.note);
    if (Object.keys(decision).length) await catalogRepository.updateDecision(params.id, decision);
    return json({ id: params.id, ...body });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update project';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 400 }
    );
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await requestObject(request);
  if (body instanceof Response) return body;
  if (
    Object.keys(body).some((key) => key !== 'action') ||
    typeof body.action !== 'string' ||
    !localProjectActions.includes(body.action as (typeof localProjectActions)[number])
  )
    return json({ error: 'action must be finder or terminal' }, { status: 400 });
  try {
    const { catalogRepository } = await import('$lib/server/scanning/runtime');
    await runProjectAction(
      catalogRepository,
      params.id,
      body.action as (typeof localProjectActions)[number]
    );
    return json({ id: params.id, action: body.action });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open project';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 409 }
    );
  }
};
