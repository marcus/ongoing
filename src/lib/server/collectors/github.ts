import type { ProjectMetrics, ProviderAvailability, SnapshotMetric } from '$lib/domain/metrics';
import type { Project } from '$lib/domain/project';
import type { HostingMetrics, TrafficMetrics } from '$lib/domain/providers';
import type { CatalogRepository, ScanLeaseOwnership } from '$lib/server/catalog/repository';
import { GitHubRequestError } from '$lib/server/github/client';
import type { GitHubHostingMetrics, GitHubRepositoryRef } from '$lib/server/github/provider';
import { runCommand, type CommandRunner } from './process';

export interface GitHubRemote {
  owner: string;
  name: string;
}

export type GitHubOriginResult =
  | { status: 'github'; remote: GitHubRemote }
  | { status: 'absent' | 'non_github' }
  | { status: 'invalid'; message: string }
  | { status: 'error'; message: string };

export interface GitHubEnrichmentOptions {
  provider: GitHubEnrichmentProvider;
  /**
   * Entries with a `github` source and no local checkout. Their remote is what the discovery pass
   * recorded, so there is no working copy to read `git config remote.origin.url` from; everything
   * after that is identical to a local project's enrichment.
   */
  remotes?: readonly { id: string; remote: GitHubRemote }[];
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
  ): Promise<Map<string, HostingMetrics | GitHubHostingMetrics | Error>>;
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
  try {
    return { owner: decodeURIComponent(parts[0]), name: decodeURIComponent(parts[1]) };
  } catch {
    return null;
  }
}

function classifyOrigin(value: string): GitHubOriginResult {
  const trimmed = value.trim();
  if (!trimmed) return { status: 'absent' };
  if (/\r|\n/.test(trimmed))
    return { status: 'error', message: 'Unable to read Git origin: malformed command output' };
  const github = parseGitHubRemote(trimmed);
  if (github) return { status: 'github', remote: github };

  const scp = trimmed.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp)
    return scp[1].toLowerCase() === 'github.com'
      ? { status: 'invalid', message: 'GitHub origin URL is invalid' }
      : { status: 'non_github' };
  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol))
      return { status: 'error', message: 'Unable to read Git origin: unsupported command output' };
    return url.hostname.toLowerCase() === 'github.com'
      ? { status: 'invalid', message: 'GitHub origin URL is invalid' }
      : { status: 'non_github' };
  } catch {
    return { status: 'error', message: 'Unable to read Git origin: malformed command output' };
  }
}

export async function readGitHubOrigin(
  repositoryPath: string,
  runner: CommandRunner = runCommand,
  signal?: AbortSignal
): Promise<GitHubOriginResult> {
  let result: Awaited<ReturnType<CommandRunner>>;
  try {
    result = await runner(['git', 'config', '--get', 'remote.origin.url'], {
      cwd: repositoryPath,
      timeoutMs: 5_000,
      signal
    });
  } catch {
    return { status: 'error', message: 'Unable to read Git origin: process failed' };
  }
  if (result.timedOut)
    return { status: 'error', message: 'Unable to read Git origin: command timed out' };
  if (result.aborted)
    return { status: 'error', message: 'Unable to read Git origin: command was aborted' };
  if (result.exitCode !== 0) {
    if (result.exitCode === 1 && !result.stdout.trim() && !result.stderr.trim())
      return { status: 'absent' };
    return { status: 'error', message: 'Unable to read Git origin: command failed' };
  }
  return classifyOrigin(result.stdout);
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

type MetricsUpdate = Partial<Omit<ProjectMetrics, 'projectId'>>;

function hostingUpdate(
  metrics: HostingMetrics | GitHubHostingMetrics,
  timestamp: string
): MetricsUpdate {
  const update: MetricsUpdate = {
    githubRepoId: metrics.repositoryId,
    githubOwner: metrics.owner,
    githubName: metrics.name,
    githubAvailability: 'available'
  };
  const mappings = [
    ['visibility', 'githubVisibility'],
    ['isArchived', 'githubIsArchived'],
    ['stars', 'githubStars'],
    ['forks', 'githubForks'],
    ['watchers', 'githubWatchers'],
    ['openIssues', 'githubOpenIssues'],
    ['openPullRequests', 'githubOpenPrs'],
    ['draftPullRequests', 'githubDraftPrs'],
    ['readyPullRequests', 'githubReadyPrs'],
    ['ownerPullRequests', 'githubOwnerPrs'],
    ['externalPullRequests', 'githubExternalPrs'],
    ['oldestExternalPullRequestAt', 'githubOldestExternalPrAt'],
    ['mergedPullRequests30d', 'githubMergedPrs30d'],
    ['mergedPullRequests90d', 'githubMergedPrs90d'],
    ['externalIssues30d', 'githubExternalIssues30d'],
    ['externalIssues90d', 'githubExternalIssues90d'],
    ['latestReleaseAt', 'githubLatestReleaseAt'],
    ['latestReleaseTag', 'githubLatestReleaseTag'],
    ['releaseDownloads', 'githubReleaseDownloads'],
    ['workflowState', 'githubCiState'],
    ['contributorCount', 'githubContributorCount']
  ] as const;
  for (const [source, target] of mappings) {
    if (source in metrics && metrics[source] !== undefined)
      (update as Record<string, unknown>)[target] = metrics[source];
  }
  if (!('graphqlComplete' in metrics) || metrics.graphqlComplete)
    update.githubScannedAt = timestamp;
  return update;
}

function trafficUpdate(metrics: TrafficMetrics, timestamp: string): MetricsUpdate {
  const update: MetricsUpdate = { githubTrafficAvailability: metrics.availability };
  if (metrics.views !== null) update.githubTrafficViews = metrics.views;
  if (metrics.uniqueVisitors !== null) update.githubTrafficUniqueVisitors = metrics.uniqueVisitors;
  if (metrics.clones !== null) update.githubTrafficClones = metrics.clones;
  if (metrics.uniqueCloners !== null) update.githubTrafficUniqueCloners = metrics.uniqueCloners;
  if (metrics.availability === 'available') update.githubTrafficScannedAt = timestamp;
  return update;
}

const clearGitHubUpdate: MetricsUpdate = {
  githubRepoId: null,
  githubOwner: null,
  githubName: null,
  githubVisibility: null,
  githubIsArchived: null,
  githubStars: null,
  githubForks: null,
  githubWatchers: null,
  githubOpenIssues: null,
  githubOpenPrs: null,
  githubDraftPrs: null,
  githubReadyPrs: null,
  githubOwnerPrs: null,
  githubExternalPrs: null,
  githubOldestExternalPrAt: null,
  githubMergedPrs30d: null,
  githubMergedPrs90d: null,
  githubExternalIssues30d: null,
  githubExternalIssues90d: null,
  githubLatestReleaseAt: null,
  githubLatestReleaseTag: null,
  githubReleaseDownloads: null,
  githubCiState: null,
  githubContributorCount: null,
  githubTrafficViews: null,
  githubTrafficUniqueVisitors: null,
  githubTrafficClones: null,
  githubTrafficUniqueCloners: null,
  githubAvailability: 'unavailable',
  githubTrafficAvailability: 'unavailable',
  githubScannedAt: null,
  githubTrafficScannedAt: null
};

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
  const originResults = await Promise.all(
    projects.map(async (project) => ({
      project,
      origin: await readGitHubOrigin(project.canonicalPath, options.runner, options.signal),
      cached: repository.getMetrics(project.id)
    }))
  );
  const mapped: {
    id: string;
    remote: GitHubRemote;
    cached: ReturnType<CatalogRepository['getMetrics']>;
  }[] = [];
  for (const { id, remote } of options.remotes ?? [])
    mapped.push({ id, remote, cached: repository.getMetrics(id) });

  for (const { project, origin, cached } of originResults) {
    if (origin.status === 'github') {
      mapped.push({ id: project.id, remote: origin.remote, cached });
      const activeOriginError = repository
        .listCollectionErrors(project.id, true)
        .find(
          ({ collector, message }) =>
            collector === 'hosting' &&
            (message.startsWith('Unable to read Git origin') ||
              message.startsWith('GitHub origin URL is invalid'))
        );
      if (activeOriginError)
        await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
      continue;
    }
    if (origin.status === 'error') {
      errorCount += 1;
      await repository.recordCollectionError(
        {
          projectId: project.id,
          collector: 'hosting',
          message: origin.message,
          occurredAt: timestamp
        },
        options.lease
      );
      continue;
    }
    await repository.updateMetrics(project.id, clearGitHubUpdate, options.lease);
    if (origin.status === 'invalid') {
      errorCount += 1;
      await repository.recordCollectionError(
        {
          projectId: project.id,
          collector: 'hosting',
          message: origin.message,
          occurredAt: timestamp
        },
        options.lease
      );
    } else await repository.resolveCollectionError(project.id, 'hosting', timestamp, options.lease);
    await repository.resolveCollectionError(project.id, 'traffic', timestamp, options.lease);
  }
  if (mapped.length === 0) return { updatedProjectIds: [], errorCount };

  let availability: ProviderAvailability;
  try {
    availability = await options.provider.availability(options.signal);
  } catch {
    availability = 'unavailable';
  }
  if (availability !== 'available') {
    for (const { id } of mapped) {
      await repository.updateMetrics(
        id,
        { githubAvailability: availability, githubTrafficAvailability: availability },
        options.lease
      );
      await repository.resolveCollectionError(id, 'hosting', timestamp, options.lease);
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
      for (const { id, remote } of dueHosting) {
        const result = results.get(`${remote.owner}/${remote.name}`);
        if (!result || result instanceof Error) {
          const failure = result instanceof GitHubRequestError ? result.failure : 'error';
          if (
            failure === 'unavailable' ||
            failure === 'unauthenticated' ||
            failure === 'rate_limited'
          ) {
            await repository.updateMetrics(id, { githubAvailability: failure }, options.lease);
            await repository.resolveCollectionError(id, 'hosting', timestamp, options.lease);
          } else {
            errorCount += 1;
            await repository.recordCollectionError(
              {
                projectId: id,
                collector: 'hosting',
                message: safeMessage(result),
                occurredAt: timestamp
              },
              options.lease
            );
          }
          continue;
        }
        await repository.updateMetrics(id, hostingUpdate(result, timestamp), options.lease);
        await snapshots(
          repository,
          id,
          [
            ['github_stars', result.stars ?? null],
            ['github_open_issues', result.openIssues ?? null],
            ['github_open_prs', result.openPullRequests ?? null]
          ],
          capturedOn,
          options.lease
        );
        await repository.resolveCollectionError(id, 'hosting', timestamp, options.lease);
        updated.add(id);
      }
    } catch (error) {
      const failure = error instanceof GitHubRequestError ? error.failure : 'error';
      for (const { id } of dueHosting) {
        if (
          failure === 'unauthenticated' ||
          failure === 'rate_limited' ||
          failure === 'unavailable'
        ) {
          await repository.updateMetrics(id, { githubAvailability: failure }, options.lease);
          await repository.resolveCollectionError(id, 'hosting', timestamp, options.lease);
        } else {
          errorCount += 1;
          await repository.recordCollectionError(
            {
              projectId: id,
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
    const metrics = repository.getMetrics(item.id);
    if (!metrics?.githubOwner || !metrics.githubName) continue;
    if (!due(metrics.githubTrafficScannedAt, now, TRAFFIC_INTERVAL_MS, options.force ?? false))
      continue;
    try {
      const traffic = await options.provider.collectTraffic(
        metrics.githubOwner,
        metrics.githubName,
        options.signal
      );
      await repository.updateMetrics(item.id, trafficUpdate(traffic, timestamp), options.lease);
      if (traffic.availability === 'available') {
        await snapshots(
          repository,
          item.id,
          [
            ['github_traffic_views', traffic.views],
            ['github_traffic_unique_visitors', traffic.uniqueVisitors],
            ['github_traffic_clones', traffic.clones],
            ['github_traffic_unique_cloners', traffic.uniqueCloners]
          ],
          capturedOn,
          options.lease
        );
        updated.add(item.id);
      } else if (
        traffic.views !== null ||
        traffic.uniqueVisitors !== null ||
        traffic.clones !== null ||
        traffic.uniqueCloners !== null
      ) {
        await snapshots(
          repository,
          item.id,
          [
            ['github_traffic_views', traffic.views],
            ['github_traffic_unique_visitors', traffic.uniqueVisitors],
            ['github_traffic_clones', traffic.clones],
            ['github_traffic_unique_cloners', traffic.uniqueCloners]
          ],
          capturedOn,
          options.lease
        );
        updated.add(item.id);
      }
      await repository.resolveCollectionError(item.id, 'traffic', timestamp, options.lease);
    } catch (error) {
      const failure = error instanceof GitHubRequestError ? error.failure : 'error';
      if (
        failure === 'unauthenticated' ||
        failure === 'rate_limited' ||
        failure === 'unavailable'
      ) {
        await repository.updateMetrics(
          item.id,
          { githubTrafficAvailability: failure },
          options.lease
        );
        await repository.resolveCollectionError(item.id, 'traffic', timestamp, options.lease);
      } else {
        errorCount += 1;
        await repository.recordCollectionError(
          {
            projectId: item.id,
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
