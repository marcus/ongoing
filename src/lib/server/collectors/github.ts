import type { ProviderAvailability, SnapshotMetric } from '$lib/domain/metrics';
import type { Project } from '$lib/domain/project';
import type { HostingMetrics, TrafficMetrics } from '$lib/domain/providers';
import type { CatalogRepository, ScanLeaseOwnership } from '$lib/server/catalog/repository';
import { GitHubRequestError } from '$lib/server/github/client';
import type { GitHubRepositoryRef } from '$lib/server/github/provider';
import { runCommand, type CommandRunner } from './process';

export interface GitHubRemote {
  owner: string;
  name: string;
}

export interface GitHubEnrichmentOptions {
  provider: GitHubEnrichmentProvider;
  now?: () => Date;
  runner?: CommandRunner;
  force?: boolean;
  signal?: AbortSignal;
  lease?: ScanLeaseOwnership;
}

export interface GitHubEnrichmentProvider {
  availability(signal?: AbortSignal): Promise<ProviderAvailability>;
  collectMany(
    refs: readonly GitHubRepositoryRef[],
    signal?: AbortSignal
  ): Promise<Map<string, HostingMetrics | Error>>;
  collectTraffic(owner: string, name: string, signal?: AbortSignal): Promise<TrafficMetrics>;
}

export interface GitHubEnrichmentResult {
  updatedProjectIds: string[];
  errorCount: number;
}

const HOSTING_INTERVAL_MS = 30 * 60_000;
const TRAFFIC_INTERVAL_MS = 24 * 60 * 60_000;

export function parseGitHubRemote(value: string): GitHubRemote | null {
  const remote = value.trim();
  let pathname: string;
  if (/^[^@\s]+@github\.com:/i.test(remote)) {
    pathname = remote.slice(remote.indexOf(':') + 1);
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return null;
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    pathname = url.pathname;
  }
  const parts = pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (parts.length !== 2 || parts.some((part) => !part || part === '.' || part === '..'))
    return null;
  return { owner: decodeURIComponent(parts[0]), name: decodeURIComponent(parts[1]) };
}

export async function readGitHubOrigin(
  repositoryPath: string,
  runner: CommandRunner = runCommand,
  signal?: AbortSignal
): Promise<GitHubRemote | null> {
  const result = await runner(['git', 'config', '--get', 'remote.origin.url'], {
    cwd: repositoryPath,
    timeoutMs: 5_000,
    signal
  });
  if (result.exitCode !== 0 || result.timedOut || result.aborted) return null;
  return parseGitHubRemote(result.stdout);
}

function due(
  value: string | null | undefined,
  now: Date,
  interval: number,
  force: boolean
): boolean {
  if (force || !value) return true;
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || now.getTime() - timestamp >= interval;
}

function hostingUpdate(metrics: HostingMetrics, timestamp: string) {
  return {
    githubRepoId: metrics.repositoryId,
    githubOwner: metrics.owner,
    githubName: metrics.name,
    githubVisibility: metrics.visibility,
    githubIsArchived: metrics.isArchived,
    githubStars: metrics.stars,
    githubForks: metrics.forks,
    githubWatchers: metrics.watchers,
    githubOpenIssues: metrics.openIssues,
    githubOpenPrs: metrics.openPullRequests,
    githubDraftPrs: metrics.draftPullRequests,
    githubReadyPrs: metrics.readyPullRequests,
    githubOwnerPrs: metrics.ownerPullRequests,
    githubExternalPrs: metrics.externalPullRequests,
    githubOldestExternalPrAt: metrics.oldestExternalPullRequestAt,
    githubMergedPrs30d: metrics.mergedPullRequests30d,
    githubMergedPrs90d: metrics.mergedPullRequests90d,
    githubExternalIssues30d: metrics.externalIssues30d,
    githubExternalIssues90d: metrics.externalIssues90d,
    githubLatestReleaseAt: metrics.latestReleaseAt,
    githubLatestReleaseTag: metrics.latestReleaseTag,
    githubReleaseDownloads: metrics.releaseDownloads,
    githubCiState: metrics.workflowState,
    githubContributorCount: metrics.contributorCount,
    githubAvailability: 'available' as const,
    githubScannedAt: timestamp
  };
}

function trafficUpdate(metrics: TrafficMetrics, timestamp: string) {
  return {
    githubTrafficViews: metrics.views,
    githubTrafficUniqueVisitors: metrics.uniqueVisitors,
    githubTrafficClones: metrics.clones,
    githubTrafficUniqueCloners: metrics.uniqueCloners,
    githubTrafficAvailability: metrics.availability,
    githubTrafficScannedAt: timestamp
  };
}

async function snapshots(
  repository: CatalogRepository,
  projectId: string,
  values: readonly [SnapshotMetric, number | null][],
  capturedOn: string,
  lease?: ScanLeaseOwnership
): Promise<void> {
  for (const [metric, value] of values) {
    if (value !== null)
      await repository.saveSnapshot({ projectId, metric, capturedOn, value }, lease);
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof GitHubRequestError) return error.message;
  return error instanceof Error ? error.message.slice(0, 1_000) : 'GitHub collection failed';
}

export async function collectGitHubEnrichment(
  repository: CatalogRepository,
  projects: readonly Project[],
  options: GitHubEnrichmentOptions
): Promise<GitHubEnrichmentResult> {
  const now = options.now?.() ?? new Date();
  const timestamp = now.toISOString();
  const capturedOn = timestamp.slice(0, 10);
  const updated = new Set<string>();
  let errorCount = 0;
  const mapped = (
    await Promise.all(
      projects.map(async (project) => ({
        project,
        remote: await readGitHubOrigin(project.canonicalPath, options.runner, options.signal),
        cached: repository.getMetrics(project.id)
      }))
    )
  ).filter(({ remote }) => remote !== null) as {
    project: Project;
    remote: GitHubRemote;
    cached: ReturnType<CatalogRepository['getMetrics']>;
  }[];

  const mappedIds = new Set(mapped.map(({ project }) => project.id));
  for (const project of projects) {
    if (!mappedIds.has(project.id) && !repository.getMetrics(project.id)?.githubRepoId) {
      await repository.updateMetrics(
        project.id,
        { githubAvailability: 'unavailable' },
        options.lease
      );
      await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
    }
  }
  if (mapped.length === 0) return { updatedProjectIds: [], errorCount: 0 };

  let availability: ProviderAvailability;
  try {
    availability = await options.provider.availability(options.signal);
  } catch {
    availability = 'unavailable';
  }
  if (availability !== 'available') {
    for (const { project } of mapped) {
      await repository.updateMetrics(
        project.id,
        { githubAvailability: availability, githubTrafficAvailability: availability },
        options.lease
      );
      await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
    }
    return { updatedProjectIds: [], errorCount: 0 };
  }

  const dueHosting = mapped.filter(({ cached }) =>
    due(cached?.githubScannedAt, now, HOSTING_INTERVAL_MS, options.force ?? false)
  );
  if (dueHosting.length) {
    try {
      const refs: GitHubRepositoryRef[] = dueHosting.map(({ remote, cached }) => ({
        ...remote,
        repositoryId: cached?.githubRepoId
      }));
      const results = await options.provider.collectMany(refs, options.signal);
      for (const { project, remote } of dueHosting) {
        const result = results.get(`${remote.owner}/${remote.name}`);
        if (!result || result instanceof Error) {
          const failure = result instanceof GitHubRequestError ? result.failure : 'error';
          if (
            failure === 'unavailable' ||
            failure === 'unauthenticated' ||
            failure === 'rate_limited'
          ) {
            await repository.updateMetrics(
              project.id,
              { githubAvailability: failure },
              options.lease
            );
            await repository.resolveCollectionError(
              project.id,
              'hosting',
              timestamp,
              options.lease
            );
          } else {
            errorCount += 1;
            await repository.recordCollectionError(
              {
                projectId: project.id,
                collector: 'hosting',
                message: safeMessage(result),
                occurredAt: timestamp
              },
              options.lease
            );
          }
          continue;
        }
        await repository.updateMetrics(project.id, hostingUpdate(result, timestamp), options.lease);
        await snapshots(
          repository,
          project.id,
          [
            ['github_stars', result.stars],
            ['github_open_issues', result.openIssues],
            ['github_open_prs', result.openPullRequests]
          ],
          capturedOn,
          options.lease
        );
        await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
        updated.add(project.id);
      }
    } catch (error) {
      const failure = error instanceof GitHubRequestError ? error.failure : 'error';
      for (const { project } of dueHosting) {
        if (
          failure === 'unauthenticated' ||
          failure === 'rate_limited' ||
          failure === 'unavailable'
        ) {
          await repository.updateMetrics(
            project.id,
            { githubAvailability: failure },
            options.lease
          );
          await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
        } else {
          errorCount += 1;
          await repository.recordCollectionError(
            {
              projectId: project.id,
              collector: 'hosting',
              message: safeMessage(error),
              occurredAt: timestamp
            },
            options.lease
          );
        }
      }
    }
  }

  for (const item of mapped) {
    const metrics = repository.getMetrics(item.project.id);
    if (!metrics?.githubOwner || !metrics.githubName) continue;
    if (!due(metrics.githubTrafficScannedAt, now, TRAFFIC_INTERVAL_MS, options.force ?? false))
      continue;
    try {
      const traffic = await options.provider.collectTraffic(
        metrics.githubOwner,
        metrics.githubName,
        options.signal
      );
      await repository.updateMetrics(
        item.project.id,
        trafficUpdate(traffic, timestamp),
        options.lease
      );
      if (traffic.availability === 'available') {
        await snapshots(
          repository,
          item.project.id,
          [
            ['github_traffic_views', traffic.views],
            ['github_traffic_unique_visitors', traffic.uniqueVisitors],
            ['github_traffic_clones', traffic.clones],
            ['github_traffic_unique_cloners', traffic.uniqueCloners]
          ],
          capturedOn,
          options.lease
        );
        updated.add(item.project.id);
      }
      await repository.resolveCollectionError(item.project.id, 'traffic', timestamp, options.lease);
    } catch (error) {
      const failure = error instanceof GitHubRequestError ? error.failure : 'error';
      if (
        failure === 'unauthenticated' ||
        failure === 'rate_limited' ||
        failure === 'unavailable'
      ) {
        await repository.updateMetrics(
          item.project.id,
          { githubTrafficAvailability: failure },
          options.lease
        );
        await repository.resolveCollectionError(
          item.project.id,
          'traffic',
          timestamp,
          options.lease
        );
      } else {
        errorCount += 1;
        await repository.recordCollectionError(
          {
            projectId: item.project.id,
            collector: 'traffic',
            message: safeMessage(error),
            occurredAt: timestamp
          },
          options.lease
        );
      }
    }
  }
  return { updatedProjectIds: [...updated], errorCount };
}
