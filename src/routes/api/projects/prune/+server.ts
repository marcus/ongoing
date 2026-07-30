import { json } from '@sveltejs/kit';
import type { Project } from '$lib/domain/project';
import type { RequestHandler } from './$types';

/**
 * Forgets every project flagged missing whose directory is confirmed gone.
 *
 * `dryRun` reports the same set without deleting, so a caller can see what would go first.
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
  if (Object.keys(fields).some((key) => key !== 'dryRun'))
    return json({ error: 'Request contains unsupported fields' }, { status: 400 });
  if (fields.dryRun !== undefined && typeof fields.dryRun !== 'boolean')
    return json({ error: 'dryRun must be a boolean' }, { status: 400 });
  const dryRun = fields.dryRun === true;

  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const { pathIsGone } = await import('$lib/server/collectors/discover');
  const summarise = ({ id, name, canonicalPath }: Project) => ({ id, name, canonicalPath });

  const missing = catalogRepository
    .listProjects({ includeHidden: true })
    .filter((project) => project.isMissing);
  const vanished: Project[] = [];
  for (const project of missing)
    if (await pathIsGone(project.canonicalPath)) vanished.push(project);

  if (dryRun) return json({ dryRun: true, forgotten: vanished.map(summarise) });

  const forgottenIds = new Set(
    await catalogRepository.forgetProjects(vanished.map(({ id }) => id))
  );
  return json({
    dryRun: false,
    forgotten: vanished.filter(({ id }) => forgottenIds.has(id)).map(summarise)
  });
};
