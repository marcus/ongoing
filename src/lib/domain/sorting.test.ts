import { describe, expect, it } from 'vitest';
import type { ProjectMetrics } from './metrics';
import type { ResolvedStack } from './stack';
import type { SortableProject, SortKey } from './sorting';
import { sortKeys, sortProjects } from './sorting';

function behind(cyclesBehind: number): ResolvedStack {
  return {
    toolchain: 'go',
    declared: '1.22',
    raw: '1.22',
    sourceFile: 'go.mod',
    status: 'behind',
    matchedCycle: '1.22',
    cycleLatestRelease: null,
    latestCycle: '1.25',
    latestRelease: null,
    cyclesBehind,
    eolFrom: null,
    baselineFetchedAt: '2026-01-01T00:00:00Z'
  };
}

function item(
  id: string,
  name: string,
  values: Partial<ProjectMetrics> & {
    manualRank?: number;
    githubStarsGained30d?: number | null;
    stacks?: ResolvedStack[];
  }
): SortableProject {
  return {
    id,
    name,
    canonicalPath: `/code/${id}`,
    relativePath: id,
    scanRoot: '/code',
    isFavorite: false,
    isHidden: false,
    manualRank: values.manualRank ?? 1_000,
    note: '',
    tags: [],
    attributes: {},
    intent: null,
    excitement: null,
    strategicImportance: null,
    nextAction: null,
    reviewAfter: null,
    isMissing: false,
    missingSince: null,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    metrics: { projectId: id, ...values } as ProjectMetrics,
    githubStarsGained30d: values.githubStarsGained30d ?? null,
    stacks: values.stacks ?? []
  };
}

type SortTestValues = Partial<ProjectMetrics> & {
  manualRank?: number;
  githubStarsGained30d?: number | null;
  stacks?: ResolvedStack[];
};

const valuesByKey: Record<SortKey, [SortTestValues, SortTestValues]> = {
  manual: [{ manualRank: 1_000 }, { manualRank: 2_000 }],
  latestCommit: [{ latestCommitAt: '2026-01-01' }, { latestCommitAt: '2026-02-01' }],
  commits30d: [{ commits30d: 1 }, { commits30d: 2 }],
  activeDays30d: [{ activeDays30d: 1 }, { activeDays30d: 2 }],
  linesOfCode: [{ locCode: 1 }, { locCode: 2 }],
  lifetimeCommits: [{ commitCount: 1 }, { commitCount: 2 }],
  openTdIssues: [{ tdTotalNonClosedCount: 1 }, { tdTotalNonClosedCount: 2 }],
  githubStars: [{ githubStars: 1 }, { githubStars: 2 }],
  githubStarsGained30d: [{ githubStarsGained30d: 1 }, { githubStarsGained30d: 2 }],
  githubOpenPrs: [{ githubOpenPrs: 1 }, { githubOpenPrs: 2 }],
  githubOldestExternalPr: [
    { githubOldestExternalPrAt: '2026-01-01' },
    { githubOldestExternalPrAt: '2026-02-01' }
  ],
  githubTraffic: [{ githubTrafficViews: 1 }, { githubTrafficViews: 2 }],
  stackLag: [{ stacks: [behind(1)] }, { stacks: [behind(2)] }],
  name: [{}, {}]
};

describe('project sorting', () => {
  it.each(sortKeys)('sorts %s in both directions without mutating input', (key) => {
    const [low, high] = valuesByKey[key];
    const first = item('a', key === 'name' ? 'Alpha' : 'Zulu', low);
    const second = item('b', key === 'name' ? 'Zulu' : 'Alpha', high);
    const input = [second, first];

    expect(sortProjects(input, key, 'asc').map(({ id }) => id)).toEqual(['a', 'b']);
    expect(sortProjects(input, key, 'desc').map(({ id }) => id)).toEqual(['b', 'a']);
    expect(input).toEqual([second, first]);
  });

  it('always puts nulls last and uses project name as the stable final tie-breaker', () => {
    const alpha = item('2', 'Alpha', { githubStars: 4 });
    const zulu = item('1', 'Zulu', { githubStars: 4 });
    const missing = item('3', 'Missing', { githubStars: null });

    expect(sortProjects([zulu, missing, alpha], 'githubStars', 'desc').map(({ id }) => id)).toEqual(
      ['2', '1', '3']
    );
    expect(sortProjects([missing, zulu, alpha], 'githubStars', 'asc').map(({ id }) => id)).toEqual([
      '2',
      '1',
      '3'
    ]);
  });
});
