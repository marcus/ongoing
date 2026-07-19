import type { Project } from './project';
import type { ProjectMetrics } from './metrics';

export const sortKeys = [
  'manual',
  'latestCommit',
  'commits30d',
  'activeDays30d',
  'linesOfCode',
  'lifetimeCommits',
  'openTdIssues',
  'githubStars',
  'githubStarsGained30d',
  'githubOpenPrs',
  'githubOldestExternalPr',
  'githubTraffic',
  'name'
] as const;

export type SortKey = (typeof sortKeys)[number];
export type SortDirection = 'asc' | 'desc';

export interface SortableProject extends Project {
  metrics: ProjectMetrics | null;
  githubStarsGained30d: number | null;
}

type SortValue = string | number | null;

const selectors: Record<SortKey, (project: SortableProject) => SortValue> = {
  manual: (project) => project.manualRank,
  latestCommit: (project) => project.metrics?.latestCommitAt ?? null,
  commits30d: (project) => project.metrics?.commits30d ?? null,
  activeDays30d: (project) => project.metrics?.activeDays30d ?? null,
  linesOfCode: (project) => project.metrics?.locCode ?? null,
  lifetimeCommits: (project) => project.metrics?.commitCount ?? null,
  openTdIssues: (project) => project.metrics?.tdTotalNonClosedCount ?? null,
  githubStars: (project) => project.metrics?.githubStars ?? null,
  githubStarsGained30d: (project) => project.githubStarsGained30d,
  githubOpenPrs: (project) => project.metrics?.githubOpenPrs ?? null,
  githubOldestExternalPr: (project) => project.metrics?.githubOldestExternalPrAt ?? null,
  githubTraffic: (project) => project.metrics?.githubTrafficViews ?? null,
  name: (project) => project.name
};

function compareValues(left: SortValue, right: SortValue, direction: SortDirection): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const comparison =
    typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'en', { sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

export function sortProjects(
  projects: readonly SortableProject[],
  key: SortKey,
  direction: SortDirection
): SortableProject[] {
  const select = selectors[key];
  return [...projects].sort((left, right) => {
    const primary = compareValues(select(left), select(right), direction);
    if (primary !== 0) return primary;

    const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id, 'en');
  });
}
