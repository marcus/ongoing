import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Project } from '$lib/domain/project';
import { findVanishedProjects } from '$lib/server/collectors/discover';
import type { CatalogRepository } from './repository';

/**
 * Forgetting projects whose directory is confirmed gone, as a library function so the route and the
 * CLI's in-process transport share the guard rather than each writing their own.
 *
 * Defaults to a dry run: deleting a project destroys its note, favourite, intent, and manual rank
 * with no undo, so the destructive form has to be asked for.
 */
export interface PruneOptions {
  dryRun?: boolean;
  graceDays?: number;
}

export interface PruneResult {
  dryRun: boolean;
  graceDays: number;
  forgotten: { id: string; name: string; canonicalPath: string; missingSince: string | null }[];
}

/** Scan roots that currently resolve, so an unreachable root never makes its projects look gone. */
export async function verifiedRoots(scanRoots: readonly string[]): Promise<string[]> {
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

export class PruneBlockedError extends Error {
  constructor() {
    super('A catalog scan is running — try again once it finishes');
    this.name = 'PruneBlockedError';
  }
}

export async function pruneMissingProjects(
  repository: CatalogRepository,
  config: { scanRoots: readonly string[]; forgetMissingAfterDays: number },
  options: PruneOptions = {}
): Promise<PruneResult> {
  const dryRun = options.dryRun !== false;
  // A scan holds the catalog and is midway through writing metrics for these very projects;
  // deleting rows underneath it fails the run on a foreign-key violation.
  if (!dryRun && repository.getActiveScanRun()) throw new PruneBlockedError();

  const graceDays = options.graceDays ?? config.forgetMissingAfterDays;
  const vanished = await findVanishedProjects(repository, {
    roots: await verifiedRoots(config.scanRoots),
    graceMs: graceDays * 86_400_000
  });
  const summarise = ({ id, name, canonicalPath, missingSince }: Project) => ({
    id,
    name,
    canonicalPath,
    missingSince
  });
  if (dryRun) return { dryRun: true, graceDays, forgotten: vanished.map(summarise) };

  const forgottenIds = new Set(await repository.forgetProjects(vanished.map(({ id }) => id)));
  const forgotten = vanished.filter(({ id }) => forgottenIds.has(id));
  for (const project of forgotten)
    console.warn(`Forgot missing project ${project.name} (${project.canonicalPath})`);
  return { dryRun: false, graceDays, forgotten: forgotten.map(summarise) };
}
