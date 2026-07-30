import { json } from '@sveltejs/kit';
import type { Project } from '$lib/domain/project';
import type { RequestHandler } from './$types';

/**
 * Forgets projects whose directory is confirmed gone.
 *
 * Defaults to a dry run. Deleting a project destroys its note, favourite, intent, and manual rank
 * with no undo, so the destructive form has to be asked for: `{"dryRun": false}`. A body-less POST
 * reports what would go rather than doing it.
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
  const dryRun = fields.dryRun !== false;

  try {
    const { catalogRepository, appConfig } = await import('$lib/server/scanning/runtime');
    const { findVanishedProjects } = await import('$lib/server/collectors/discover');
    // A scan holds the catalog and is midway through writing metrics for these very projects;
    // deleting rows underneath it fails the run on a foreign-key violation.
    if (!dryRun && catalogRepository.getActiveScanRun())
      return json(
        { error: 'A catalog scan is running — try again once it finishes' },
        {
          status: 409
        }
      );

    const graceDays = (fields.graceDays as number | undefined) ?? appConfig.forgetMissingAfterDays;
    // Only roots that still resolve: a project under an unmounted volume reads as gone but is not.
    const roots = await verifiedRoots(appConfig.scanRoots);
    const vanished = await findVanishedProjects(catalogRepository, {
      roots,
      graceMs: graceDays * 86_400_000
    });
    const summarise = ({ id, name, canonicalPath, missingSince }: Project) => ({
      id,
      name,
      canonicalPath,
      missingSince
    });

    if (dryRun) return json({ dryRun: true, graceDays, forgotten: vanished.map(summarise) });

    const forgottenIds = new Set(
      await catalogRepository.forgetProjects(vanished.map(({ id }) => id))
    );
    const forgotten = vanished.filter(({ id }) => forgottenIds.has(id));
    for (const project of forgotten)
      console.warn(`Forgot missing project ${project.name} (${project.canonicalPath})`);
    return json({ dryRun: false, graceDays, forgotten: forgotten.map(summarise) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Unable to prune projects' },
      { status: 500 }
    );
  }
};

/** Scan roots that currently resolve, so an unreachable root never makes its projects look gone. */
async function verifiedRoots(scanRoots: readonly string[]): Promise<string[]> {
  const { realpath } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const resolved = await Promise.all(
    scanRoots.map(async (root) => {
      try {
        return await realpath(resolve(root));
      } catch {
        return null;
      }
    })
  );
  return resolved.filter((root): root is string => root !== null);
}
