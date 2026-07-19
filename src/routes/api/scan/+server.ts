import { json } from '@sveltejs/kit';
import { ScanInProgressError, type RefreshPolicy } from '$lib/server/scanning/scanner';
import type { RequestHandler } from './$types';

const refreshPolicies = new Set<RefreshPolicy>(['cheap', 'changed', 'full']);

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json({ error: 'Request body must be an object' }, { status: 400 });
  const input = body as Record<string, unknown>;
  const projectId = input.projectId;
  const refresh = input.refresh;
  if (projectId !== undefined && (typeof projectId !== 'string' || !projectId))
    return json({ error: 'projectId must be a non-empty string' }, { status: 400 });
  if (refresh !== undefined && !refreshPolicies.has(refresh as RefreshPolicy))
    return json({ error: 'refresh must be cheap, changed, or full' }, { status: 400 });

  try {
    const { catalogScanner } = await import('$lib/server/scanning/runtime');
    const handle = await catalogScanner.start({
      reason: projectId ? 'project' : 'manual',
      projectId: projectId as string | undefined,
      refresh: refresh as RefreshPolicy | undefined
    });
    void handle.completion;
    return json({ runId: handle.runId, status: 'running' }, { status: 202 });
  } catch (error) {
    if (error instanceof ScanInProgressError)
      return json({ error: error.message, runId: error.runId }, { status: 409 });
    const message = error instanceof Error ? error.message : 'Unable to start scan';
    return json(
      { error: message },
      { status: message.startsWith('Unknown project ID:') ? 404 : 400 }
    );
  }
};
