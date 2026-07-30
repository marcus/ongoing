import { describe, expect, it } from 'vitest';
import type { ProjectMetrics } from '$lib/domain/metrics';
import { classifyAttentionViews } from '$lib/domain/attention';
import { resolveStack, type ResolvedStack, type Toolchain } from '$lib/domain/stack';
import type { DashboardProject } from './catalog';
import {
  applyDashboardQuery,
  classifyProject,
  metricDelta30d,
  parseDashboardQuery,
  stackCounts
} from './catalog';

function declares(toolchain: Toolchain, declared = '1.0'): ResolvedStack {
  return resolveStack({ toolchain, declared, raw: declared, sourceFile: 'manifest' }, []);
}

function project(
  id: string,
  name: string,
  options: {
    favorite?: boolean;
    missing?: boolean;
    metrics?: Partial<ProjectMetrics>;
    starsDelta?: number | null;
    stacks?: ResolvedStack[];
  } = {}
): DashboardProject {
  const base = {
    id,
    name,
    canonicalPath: `/code/${id}`,
    relativePath: id,
    scanRoot: '/code',
    isFavorite: options.favorite ?? false,
    isHidden: false,
    manualRank: 1_000,
    note: `${name} note`,
    intent: null,
    excitement: null,
    strategicImportance: null,
    nextAction: null,
    reviewAfter: null,
    isMissing: options.missing ?? false,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metrics: { projectId: id, ...options.metrics } as ProjectMetrics,
    githubStarsGained30d: options.starsDelta ?? null,
    githubTrafficViewsDelta30d: null,
    githubTrafficClonesDelta30d: null,
    stacks: options.stacks ?? [],
    errors: [],
    snapshots: []
  };
  const now = Date.parse('2026-07-19T00:00:00Z');
  const attention = classifyAttentionViews(base, now);
  return { ...base, attention, views: classifyProject(base, now) };
}

describe('dashboard catalog model', () => {
  it('parses all URL-backed controls and falls back safely', () => {
    expect(
      parseDashboardQuery(
        new URLSearchParams(
          'sort=githubOldestExternalPr&dir=asc&q=release&filter=warnings&view=attention&stack=go&group=none'
        )
      )
    ).toEqual({
      sort: 'githubOldestExternalPr',
      direction: 'asc',
      search: 'release',
      filter: 'warnings',
      view: 'attention',
      stack: 'go',
      group: 'none'
    });

    expect(
      parseDashboardQuery(new URLSearchParams('sort=wat&filter=wat&view=wat&stack=cobol'))
    ).toMatchObject({
      sort: 'latestCommit',
      direction: 'desc',
      filter: 'all',
      view: null,
      stack: null,
      group: 'favorites'
    });
  });

  it('filters to a single declared toolchain and counts what is available', () => {
    const api = project('api', 'Api', { stacks: [declares('go'), declares('node')] });
    const site = project('site', 'Site', { stacks: [declares('node')] });
    const shell = project('shell', 'Shell', {});
    const projects = [api, site, shell];

    const withStack = (stack: string) =>
      applyDashboardQuery(projects, parseDashboardQuery(new URLSearchParams(`stack=${stack}`))).map(
        ({ id }) => id
      );
    expect(withStack('go')).toEqual(['api']);
    expect(withStack('node')).toEqual(['api', 'site']);
    expect(withStack('rust')).toEqual([]);
    // An unknown toolchain falls back to no filter rather than an empty dashboard.
    expect(withStack('cobol')).toEqual(['api', 'shell', 'site']);

    expect(stackCounts(projects)).toEqual([
      { key: 'node', count: 2 },
      { key: 'go', count: 1 }
    ]);
  });

  it('classifies transparent attention views from cached metrics', () => {
    const item = project('rising', 'Rising', {
      metrics: {
        latestCommitAt: '2026-07-18T00:00:00Z',
        commits30d: 12,
        activeDays30d: 7,
        githubStars: 50,
        githubCiState: 'failure',
        gitScannedAt: '2026-07-18T23:00:00Z',
        githubScannedAt: '2026-07-18T23:00:00Z',
        githubAvailability: 'available'
      },
      starsDelta: 5
    });
    expect(item.views).toEqual(expect.arrayContaining(['attention', 'rising', 'momentum']));
  });

  it('combines search, filters, favorites grouping, and stable sort order', () => {
    const alpha = project('a', 'Alpha', {
      favorite: true,
      metrics: { githubStars: 5, githubRepoId: 'A' }
    });
    const beta = project('b', 'Beta', { metrics: { githubStars: 20, githubRepoId: 'B' } });
    const alphabet = project('c', 'Alphabet', {
      favorite: true,
      metrics: { githubStars: 20, githubRepoId: 'C' }
    });
    const query = parseDashboardQuery(
      new URLSearchParams('sort=githubStars&dir=desc&q=alpha&filter=favorites&group=favorites')
    );
    expect(applyDashboardQuery([beta, alphabet, alpha], query).map(({ id }) => id)).toEqual([
      'c',
      'a'
    ]);
  });

  it('calculates stable 30-day deltas from the latest snapshot at or before the cutoff', () => {
    expect(
      metricDelta30d(
        [
          { projectId: 'a', metric: 'github_traffic_views', capturedOn: '2026-06-17', value: 30 },
          { projectId: 'a', metric: 'github_traffic_views', capturedOn: '2026-06-19', value: 40 },
          { projectId: 'a', metric: 'github_traffic_views', capturedOn: '2026-07-10', value: 70 }
        ],
        'github_traffic_views',
        100,
        Date.parse('2026-07-19T12:00:00Z')
      )
    ).toBe(60);
  });
});
