import { scanProgress } from '$lib/server/scanning/progress';
import { createScanEventResponse } from '$lib/server/scanning/sse';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, request }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const runId = url.searchParams.get('runId');
  if (!runId || !catalogRepository.getScanRun(runId))
    return new Response(JSON.stringify({ error: 'Unknown scan run' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  const headerId = request.headers.get('last-event-id');
  const queryId = url.searchParams.get('lastEventId');
  const lastEventId = Number(headerId ?? queryId ?? 0);
  if (!Number.isSafeInteger(lastEventId) || lastEventId < 0)
    return new Response(JSON.stringify({ error: 'Invalid event cursor' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });

  return createScanEventResponse({
    runId,
    lastEventId,
    signal: request.signal,
    repository: catalogRepository,
    progress: scanProgress
  });
};
