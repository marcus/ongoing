import { describe, expect, it, vi } from 'vitest';
import { GitHubRequestError, type GitHubClient } from './client';
import { GitHubHostingMetricsProvider } from './provider';

function fakeClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  const client = {
    availability: async () => 'available',
    graphql: async () => ({
      data: {
        r0: {
          id: 'R_node',
          name: 'repo-renamed',
          owner: { login: 'owner' },
          visibility: 'PRIVATE',
          isArchived: true,
          stargazerCount: 12,
          forkCount: 3,
          watchers: { totalCount: 4 },
          issues: { totalCount: 5 },
          pullRequests: {
            totalCount: 3,
            nodes: [
              { isDraft: true, createdAt: '2026-01-01T00:00:00Z', author: { login: 'guest' } },
              { isDraft: false, createdAt: '2026-02-01T00:00:00Z', author: { login: 'owner' } },
              { isDraft: false, createdAt: '2026-03-01T00:00:00Z', author: null }
            ]
          },
          defaultBranchRef: { name: 'main' }
        },
        d_0: { issueCount: 1 },
        y_0: { issueCount: 2 },
        o_0: { issueCount: 1 },
        x_0: { issueCount: 2, nodes: [{ createdAt: '2026-01-01T00:00:00Z' }] },
        m30_0: { issueCount: 2 },
        m90_0: { issueCount: 7 },
        e30_0: { issueCount: 1 },
        e90_0: { issueCount: 6 }
      }
    }),
    rest: async (path: string) => {
      if (path.includes('/releases/latest'))
        return {
          data: {
            published_at: '2026-07-01T00:00:00Z',
            tag_name: 'v2.0.0',
            assets: [{ download_count: 10 }, { download_count: 5 }]
          },
          headers: new Headers()
        } as never;
      if (path.includes('/actions/runs'))
        return {
          data: { workflow_runs: [{ status: 'completed', conclusion: 'failure' }] },
          headers: new Headers()
        } as never;
      if (path.includes('/contributors'))
        return {
          data: [{}],
          headers: new Headers({ link: '<https://api.github.com/x?page=8>; rel="last"' })
        } as never;
      if (path.endsWith('/traffic/views'))
        return { data: { count: 100, uniques: 20 }, headers: new Headers() } as never;
      return { data: { count: 30, uniques: 8 }, headers: new Headers() } as never;
    },
    ...overrides
  };
  return client as GitHubClient;
}

describe('GitHubHostingMetricsProvider', () => {
  it('batches counters and enriches every planned hosting field with REST details', async () => {
    const client = fakeClient();
    const graphql = vi.spyOn(client, 'graphql');
    const provider = new GitHubHostingMetricsProvider(
      client,
      () => new Date('2026-07-19T00:00:00Z')
    );

    const results = await provider.collectMany([
      { owner: 'old-owner', name: 'old-name', repositoryId: 'R_node' }
    ]);

    expect(graphql).toHaveBeenCalledOnce();
    expect(graphql.mock.calls[0][0]).toContain('node(id:"R_node")');
    expect(graphql.mock.calls[0][0]).toMatch(/watchers\(first:\$connectionPage\)/);
    expect(graphql.mock.calls[0][0]).toMatch(/issues\(states:OPEN,first:\$connectionPage\)/);
    expect(graphql.mock.calls[0][0].match(/search\([^\n]+first:\$connectionPage\)/g)).toHaveLength(
      8
    );
    expect(graphql.mock.calls[0][1]).toEqual({ connectionPage: 1, pullRequestPage: 100 });
    expect(results.get('old-owner/old-name')).toMatchObject({
      repositoryId: 'R_node',
      owner: 'owner',
      name: 'repo-renamed',
      visibility: 'private',
      isArchived: true,
      stars: 12,
      forks: 3,
      watchers: 4,
      openIssues: 5,
      openPullRequests: 3,
      draftPullRequests: 1,
      readyPullRequests: 2,
      ownerPullRequests: 1,
      externalPullRequests: 2,
      oldestExternalPullRequestAt: '2026-01-01T00:00:00Z',
      mergedPullRequests30d: 2,
      mergedPullRequests90d: 7,
      externalIssues30d: 1,
      externalIssues90d: 6,
      latestReleaseTag: 'v2.0.0',
      releaseDownloads: 15,
      workflowState: 'failure',
      contributorCount: 8
    });
  });

  it('clamps caller-provided connection bounds to GitHub supported limits', async () => {
    const client = fakeClient();
    const graphql = vi.spyOn(client, 'graphql');
    const provider = new GitHubHostingMetricsProvider(
      client,
      () => new Date('2026-07-19T00:00:00Z'),
      { connection: -20, pullRequests: 900 }
    );
    await provider.collectMany([{ owner: 'owner', name: 'repo' }]);
    expect(graphql.mock.calls[0][1]).toEqual({ connectionPage: 1, pullRequestPage: 100 });
  });

  it('omits errored aliases so callers can retain each cached field', async () => {
    const client = fakeClient();
    const original = client.graphql.bind(client);
    client.graphql = (async (...args: Parameters<GitHubClient['graphql']>) => {
      const response = (await original(...args)) as Awaited<ReturnType<GitHubClient['graphql']>>;
      const data = { ...(response.data as Record<string, unknown>) };
      delete data.m30_0;
      return { data, errors: [{ message: 'search failed', path: ['m30_0'] }] };
    }) as GitHubClient['graphql'];
    const result = await new GitHubHostingMetricsProvider(client).collectMany([
      { owner: 'owner', name: 'repo' }
    ]);
    const metrics = result.get('owner/repo');
    expect(metrics).not.toBeInstanceOf(Error);
    expect(metrics).not.toHaveProperty('mergedPullRequests30d');
    expect(metrics).toMatchObject({ stars: 12, mergedPullRequests90d: 7, graphqlComplete: false });
  });

  it.each(['releases/latest', 'actions/runs', 'contributors'])(
    'isolates optional REST failure for %s',
    async (failedPath) => {
      const base = fakeClient();
      const rest = base.rest.bind(base);
      base.rest = (async (path: string, signal?: AbortSignal) => {
        if (path.includes(failedPath)) throw new Error('optional endpoint failed');
        return rest(path, signal);
      }) as GitHubClient['rest'];
      const result = await new GitHubHostingMetricsProvider(base).collectMany([
        { owner: 'owner', name: 'repo' }
      ]);
      const metrics = result.get('owner/repo');
      expect(metrics).toEqual(expect.objectContaining({ stars: 12 }));
      if (failedPath !== 'releases/latest')
        expect(metrics).toEqual(expect.objectContaining({ latestReleaseTag: 'v2.0.0' }));
      if (failedPath !== 'actions/runs')
        expect(metrics).toEqual(expect.objectContaining({ workflowState: 'failure' }));
      if (failedPath !== 'contributors')
        expect(metrics).toEqual(expect.objectContaining({ contributorCount: 8 }));
    }
  );

  it('keeps a successful traffic endpoint when its sibling fails', async () => {
    const base = fakeClient();
    const rest = base.rest.bind(base);
    base.rest = (async (path: string, signal?: AbortSignal) => {
      if (path.endsWith('/traffic/views'))
        throw new GitHubRequestError('forbidden', 'unavailable', 403);
      return rest(path, signal);
    }) as GitHubClient['rest'];
    await expect(
      new GitHubHostingMetricsProvider(base).collectTraffic('owner', 'repo')
    ).resolves.toEqual({
      availability: 'unavailable',
      views: null,
      uniqueVisitors: null,
      clones: 30,
      uniqueCloners: 8
    });
  });

  it('normalizes missing traffic permission without throwing or noisy errors', async () => {
    const provider = new GitHubHostingMetricsProvider(
      fakeClient({
        rest: async () => {
          throw new GitHubRequestError('forbidden', 'unavailable', 403);
        }
      })
    );
    await expect(provider.collectTraffic('owner', 'repo')).resolves.toEqual({
      availability: 'unavailable',
      views: null,
      uniqueVisitors: null,
      clones: null,
      uniqueCloners: null
    });
  });

  it('returns per-repository unavailable results for private or missing GraphQL nodes', async () => {
    const provider = new GitHubHostingMetricsProvider(
      fakeClient({
        graphql: (async () => ({
          data: { r0: null },
          errors: [{ message: 'no', path: ['r0'] }]
        })) as GitHubClient['graphql']
      })
    );
    const result = await provider.collectMany([{ owner: 'owner', name: 'private' }]);
    expect(result.get('owner/private')).toBeInstanceOf(GitHubRequestError);
    expect((result.get('owner/private') as GitHubRequestError).failure).toBe('unavailable');
  });
});
