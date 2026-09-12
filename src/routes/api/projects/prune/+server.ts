import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Forgets projects whose directory is confirmed gone.
 *
 * Defaults to a dry run. Deleting a project destroys its note, favourite, intent, and manual rank
 * with no undo, so the destructive form has to be asked for: `{"dryRun": false}`. A body-less POST
 * reports what would go rather than doing it. The rule itself lives in
 * `$lib/server/catalog/prune`, which the CLI's in-process transport calls too.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Request body must be JSON' }, { status: 400 });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return json({ error: 'Request body must be an object' }, { status: 400 });
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !['dryRun', 'graceDays'].includes(key)))
    return json({ error: 'Request contains unsupported fields' }, { status: 400 });
  if (fields.dryRun !== undefined && typeof fields.dryRun !== 'boolean')
    return json({ error: 'dryRun must be a boolean' }, { status: 400 });
  if (
    fields.graceDays !== undefined &&
    (typeof fields.graceDays !== 'number' ||
      !Number.isInteger(fields.graceDays) ||
      fields.graceDays < 0)
  )
    return json({ error: 'graceDays must be a non-negative integer' }, { status: 400 });

  try {
    const { catalogRepository, appConfig } = await import('$lib/server/scanning/runtime');
    const { pruneMissingProjects, PruneBlockedError } = await import('$lib/server/catalog/prune');
    try {
      return json(
        await pruneMissingProjects(catalogRepository, appConfig, {
          dryRun: fields.dryRun as boolean | undefined,
          graceDays: fields.graceDays as number | undefined
        })
      );
    } catch (error) {
      if (error instanceof PruneBlockedError)
        return json({ error: error.message }, { status: 409 });
      throw error;
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to prune projects' },
      { status: 500 }
    );
  }
};
