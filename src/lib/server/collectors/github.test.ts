import { describe, expect, it, vi } from 'vitest';
import type { HostingMetrics, TrafficMetrics } from '$lib/domain/providers';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { GitHubRequestError } from '$lib/server/github/client';
import type { CommandRunner } from './process';
import {
  collectGitHubEnrichment,
  parseGitHubRemote,
  type GitHubEnrichmentProvider
} from './github';

const now = new Date('2026-07-19T12:00:00Z');
const hosting: HostingMetrics = {
  repositoryId: 'R_1',
  owner: 'owner',
  name: 'repo',
  visibility: 'public',
  isArchived: false,
  stars: 10,
  forks: 2,
  watchers: 3,
  openIssues: 4,
  openPullRequests: 2,
  draftPullRequests: 1,
  readyPullRequests: 1,
  ownerPullRequests: 1,
  externalPullRequests: 1,
  oldestExternalPullRequestAt: '2026-06-01T00:00:00Z',
  mergedPullRequests30d: 2,
  mergedPullRequests90d: 5,
  externalIssues30d: 1,
  externalIssues90d: 3,
  latestReleaseAt: '2026-07-01T00:00:00Z',
  latestReleaseTag: 'v1',
  releaseDownloads: 20,
  workflowState: 'success',
  contributorCount: 4
};
const traffic: TrafficMetrics = {
  availability: 'available',
  views: 100,
  uniqueVisitors: 25,
  clones: 30,
  uniqueCloners: 8
};

function provider(overrides: Partial<GitHubEnrichmentProvider> = {}): GitHubEnrichmentProvider {
  return {
    availability: async () => 'available',
    collectMany: async (refs) => new Map(refs.map((ref) => [`${ref.owner}/${ref.name}`, hosting])),
    collectTraffic: async () => traffic,
    ...overrides
  };
}

async function fixture() {
  const database = new CatalogDatabase(':memory:');
  const repository = new CatalogRepository(database, () => now.toISOString());
  const project = await repository.upsertDiscovered({
    canonicalPath: '/code/repo',
    relativePath: 'repo',
    name: 'repo',
    scanRoot: '/code'
  });
  return { database, repository, project };
}

const origin: CommandRunner = async () => ({
  command: ['git'],
  cwd: '/code/repo',
  stdout: 'git@github.com:owner/repo.git\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  aborted: false
});

describe('GitHub remote parsing', () => {
  it.each([
    ['git@github.com:Owner/repo.git', { owner: 'Owner', name: 'repo' }],
    ['ssh://git@github.com/Owner/repo.git', { owner: 'Owner', name: 'repo' }],
    ['https://github.com/Owner/repo.git', { owner: 'Owner', name: 'repo' }],
    ['git://github.com/Owner/repo', { owner: 'Owner', name: 'repo' }]
  ])('parses %s', (remote, expected) => expect(parseGitHubRemote(remote)).toEqual(expected));
  it.each([
    'https://gitlab.com/a/b',
    'git@example.com:a/b.git',
    'https://github.com/a/b/extra',
    'bogus'
  ])('rejects non-GitHub or malformed remote %s', (remote) =>
    expect(parseGitHubRemote(remote)).toBeNull()
  );
});

describe('cached GitHub enrichment', () => {
  it('persists all values and daily idempotent snapshots, then skips fresh cache', async () => {
    const { database, repository, project } = await fixture();
    const fake = provider();
    const collectMany = vi.spyOn(fake, 'collectMany');
    await collectGitHubEnrichment(repository, [project], {
      provider: fake,
      runner: origin,
      now: () => now
    });
    await collectGitHubEnrichment(repository, [project], {
      provider: fake,
      runner: origin,
      now: () => now
    });
    expect(collectMany).toHaveBeenCalledOnce();
    expect(repository.getMetrics(project.id)).toMatchObject({
      githubRepoId: 'R_1',
      githubStars: 10,
      githubTrafficViews: 100,
      githubAvailability: 'available',
      githubTrafficAvailability: 'available'
    });
    expect(repository.listSnapshots(project.id)).toHaveLength(7);
    database.close();
  });

  it('queries by retained node ID after a remote URL rename', async () => {
    const { database, repository, project } = await fixture();
    await repository.updateMetrics(project.id, {
      githubRepoId: 'R_old',
      githubScannedAt: '2026-07-01T00:00:00Z'
    });
    let refs: readonly { repositoryId?: string | null }[] = [];
    const renamedOrigin: CommandRunner = async () => ({
      command: ['git'],
      cwd: '/code/repo',
      stdout: 'https://github.com/new/repo.git',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      aborted: false
    });
    await collectGitHubEnrichment(repository, [project], {
      provider: provider({
        collectMany: async (value) => {
          refs = value;
          return new Map([['new/repo', hosting]]);
        }
      }),
      runner: renamedOrigin,
      now: () => now
    });
    expect(refs[0]?.repositoryId).toBe('R_old');
    database.close();
  });

  it.each([
    ['unauthenticated', 'unauthenticated'],
    ['rate_limited', 'rate_limited']
  ] as const)(
    'preserves cache for %s diagnostics without row errors',
    async (failure, expected) => {
      const { database, repository, project } = await fixture();
      await repository.updateMetrics(project.id, {
        githubStars: 9,
        githubScannedAt: '2026-07-01T00:00:00Z'
      });
      const result = await collectGitHubEnrichment(repository, [project], {
        provider: provider({ availability: async () => failure }),
        runner: origin,
        now: () => now
      });
      expect(result.errorCount).toBe(0);
      expect(repository.getMetrics(project.id)).toMatchObject({
        githubStars: 9,
        githubAvailability: expected
      });
      expect(repository.listCollectionErrors(project.id, true)).toEqual([]);
      database.close();
    }
  );

  it('records response errors while keeping cached counters and makes traffic permission quiet', async () => {
    const { database, repository, project } = await fixture();
    await repository.updateMetrics(project.id, { githubStars: 9 });
    const result = await collectGitHubEnrichment(repository, [project], {
      provider: provider({
        collectMany: async () => {
          throw new Error('upstream exploded');
        },
        collectTraffic: async () => {
          throw new GitHubRequestError('forbidden', 'unavailable', 403);
        }
      }),
      runner: origin,
      now: () => now
    });
    expect(result.errorCount).toBe(1);
    expect(repository.getMetrics(project.id)?.githubStars).toBe(9);
    expect(repository.listCollectionErrors(project.id, true)).toEqual([
      expect.objectContaining({ collector: 'hosting', message: 'upstream exploded' })
    ]);
    database.close();
  });

  it('stores partial traffic permission as unavailable without an active row error', async () => {
    const { database, repository, project } = await fixture();
    await collectGitHubEnrichment(repository, [project], {
      provider: provider({
        collectTraffic: async () => ({
          availability: 'unavailable',
          views: null,
          uniqueVisitors: null,
          clones: null,
          uniqueCloners: null
        })
      }),
      runner: origin,
      now: () => now
    });
    expect(repository.getMetrics(project.id)).toMatchObject({
      githubStars: 10,
      githubTrafficAvailability: 'unavailable',
      githubTrafficScannedAt: now.toISOString()
    });
    expect(repository.listCollectionErrors(project.id, true)).toEqual([]);
    database.close();
  });
});
