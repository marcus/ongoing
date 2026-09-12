import type { CatalogRepository, ScanLeaseOwnership } from '$lib/server/catalog/repository';
import type { RemoteRepository } from '$lib/server/github/discovery';

/**
 * Remote-only entries (Phase 6).
 *
 * A repository that has never been cloned is still part of the inventory. When configuration names
 * owners under `[providers.github] discover`, this reconciles the catalog against what those owners
 * actually have: a repository nothing local claims becomes an entry with a `github` source and no
 * filesystem source, so every surface can see it and none of them can pretend it has a path.
 *
 * Like the `tech-signatures` edges, what this provider writes it also owns: a remote-only entry
 * whose repository has been cloned locally, or no longer exists, is dropped on the next pass —
 * unless somebody has written a note or a tag on it, which is a decision the scan has no business
 * deleting.
 */
export const GITHUB_SOURCE_PROVIDER = 'github';

export interface RemoteDiscoveryOptions {
  owners: readonly string[];
  list: (owner: string, signal?: AbortSignal) => Promise<RemoteRepository[]>;
  /** Repositories a remote-only entry should never be made for. */
  includeForks?: boolean;
  includeArchived?: boolean;
  signal?: AbortSignal;
  lease?: ScanLeaseOwnership;
}

export interface RemoteDiscoveryResult {
  /** Entries that exist now because of this pass, plus the ones it refreshed. */
  entryIds: string[];
  created: number;
  removed: number;
  /** Entries kept although their repository is claimed or gone, because they carry a person's text. */
  kept: number;
  /** Owners whose listing failed, with the reason. */
  failures: { owner: string; message: string }[];
}

function locatorFor(repository: RemoteRepository): string {
  return `${repository.owner}/${repository.name}`;
}

/** What a local checkout already says it is on GitHub, so discovery does not duplicate it. */
function claimedLocally(repository: CatalogRepository): Set<string> {
  const claimed = new Set<string>();
  for (const project of repository.listProjects({ includeHidden: true })) {
    const metrics = repository.getMetrics(project.id);
    if (metrics?.githubOwner && metrics.githubName)
      claimed.add(`${metrics.githubOwner}/${metrics.githubName}`.toLowerCase());
  }
  return claimed;
}

export async function discoverRemoteRepositories(
  repository: CatalogRepository,
  options: RemoteDiscoveryOptions
): Promise<RemoteDiscoveryResult> {
  const result: RemoteDiscoveryResult = {
    entryIds: [],
    created: 0,
    removed: 0,
    kept: 0,
    failures: []
  };
  if (!options.owners.length) return result;

  const listed = new Map<string, RemoteRepository>();
  for (const owner of options.owners) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      for (const found of await options.list(owner, options.signal)) {
        if (!options.includeForks && found.isFork) continue;
        if (!options.includeArchived && found.isArchived) continue;
        listed.set(locatorFor(found).toLowerCase(), found);
      }
    } catch (error) {
      result.failures.push({
        owner,
        message: error instanceof Error ? error.message.slice(0, 500) : String(error)
      });
    }
  }

  const claimed = claimedLocally(repository);
  const existing = repository.listRemoteProjects(GITHUB_SOURCE_PROVIDER);
  const known = new Set(existing.map(({ locator }) => locator.toLowerCase()));

  for (const [key, found] of listed) {
    if (claimed.has(key)) continue;
    const before = known.has(key);
    const entry = await repository.upsertRemoteProject(
      {
        provider: GITHUB_SOURCE_PROVIDER,
        locator: locatorFor(found),
        name: found.name,
        metadata: {
          repositoryId: found.repositoryId,
          visibility: found.visibility,
          isFork: found.isFork,
          isArchived: found.isArchived
        }
      },
      options.lease
    );
    result.entryIds.push(entry.id);
    if (!before) result.created += 1;
  }

  // Nothing is removed while an owner's listing failed: an empty answer we could not get is not
  // evidence that a repository is gone.
  if (result.failures.length) return result;

  for (const { entry, locator } of existing) {
    const key = locator.toLowerCase();
    if (listed.has(key) && !claimed.has(key)) continue;
    if (entry.note.trim() || entry.tags.length) {
      result.kept += 1;
      continue;
    }
    await repository.deleteEntry(entry.id);
    result.removed += 1;
    result.entryIds = result.entryIds.filter((id) => id !== entry.id);
  }
  return result;
}
