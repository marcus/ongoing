import type { Toolchain } from '$lib/domain/stack';
import type { CatalogRepository, ScanLeaseOwnership } from '$lib/server/catalog/repository';
import { createConcurrencyLimit } from '$lib/server/scanning/limit';
import { releaseProductId, ReleaseBaselineError, type ReleaseBaselineProvider } from './endoflife';

/** A failed refresh retries sooner than a successful one, without hammering the upstream API. */
export const FAILURE_RETRY_HOURS = 1;

const REFRESH_CONCURRENCY = 3;
const HOUR = 3_600_000;

export interface BaselineRefreshOptions {
  provider: ReleaseBaselineProvider;
  maxAgeHours: number;
  force?: boolean;
  now?: () => string;
  signal?: AbortSignal;
  lease?: ScanLeaseOwnership;
}

export interface BaselineRefreshResult {
  refreshed: Toolchain[];
  failed: Toolchain[];
  skipped: Toolchain[];
}

/**
 * Refresh cached release data for the toolchains projects actually declare.
 *
 * A failure never discards what is already cached — `replaceToolchainReleases` only rewrites cycles
 * on success. Stale cached data then simply stops satisfying the Upgrade view's freshness gate,
 * which is the intended degradation: no claims rather than wrong ones.
 */
export async function refreshReleaseBaselines(
  repository: CatalogRepository,
  options: BaselineRefreshOptions
): Promise<BaselineRefreshResult> {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp))
    throw new Error('Release baseline clock returned an invalid time');

  const declared = new Set<Toolchain>();
  for (const stacks of repository.listAllProjectStacks().values())
    for (const stack of stacks)
      if (releaseProductId(stack.toolchain)) declared.add(stack.toolchain);

  const status = new Map(
    repository.listBaselineStatus().map((entry) => [entry.toolchain, entry] as const)
  );
  const stale = (toolchain: Toolchain): boolean => {
    if (options.force) return true;
    const entry = status.get(toolchain);
    if (!entry) return true;
    const attempted = Date.parse(entry.fetchedAt);
    if (!Number.isFinite(attempted)) return true;
    const maxAge = entry.availability === 'available' ? options.maxAgeHours : FAILURE_RETRY_HOURS;
    return timestamp - attempted >= maxAge * HOUR;
  };

  const result: BaselineRefreshResult = { refreshed: [], failed: [], skipped: [] };
  const toolchains = [...declared].sort();
  const limit = createConcurrencyLimit(REFRESH_CONCURRENCY);

  await Promise.all(
    toolchains.map((toolchain) =>
      limit(async () => {
        if (!stale(toolchain)) {
          result.skipped.push(toolchain);
          return;
        }
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('Scan aborted');
        try {
          const releases = await options.provider.fetchCycles(toolchain, options.signal);
          await repository.replaceToolchainReleases(
            { toolchain, availability: 'available', fetchedAt: now, message: null },
            releases,
            options.lease
          );
          result.refreshed.push(toolchain);
        } catch (error) {
          if (options.signal?.aborted) throw options.signal.reason ?? error;
          await repository.replaceToolchainReleases(
            {
              toolchain,
              availability:
                error instanceof ReleaseBaselineError ? error.availability : 'unavailable',
              fetchedAt: now,
              message: (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
            },
            [],
            options.lease
          );
          result.failed.push(toolchain);
        }
      })
    )
  );

  result.refreshed.sort();
  result.failed.sort();
  return result;
}
