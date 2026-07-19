import type { CollectionError, MetricSnapshot, ScanRun } from '$lib/domain/metrics';
import {
  sortKeys,
  sortProjects,
  type SortableProject,
  type SortDirection,
  type SortKey
} from '$lib/domain/sorting';
import type { CatalogRepository } from '$lib/server/catalog/repository';

export const viewKeys = [
  'attention',
  'rising',
  'quickwin',
  'opportunity',
  'momentum',
  'dormant'
] as const;
export const filterKeys = ['all', 'favorites', 'missing', 'warnings', 'local'] as const;
export const groupKeys = ['none', 'favorites'] as const;

export type ViewKey = (typeof viewKeys)[number];
export type FilterKey = (typeof filterKeys)[number];
export type GroupKey = (typeof groupKeys)[number];

export interface DashboardProject extends SortableProject {
  errors: CollectionError[];
  snapshots: MetricSnapshot[];
  views: ViewKey[];
}

export interface DashboardQuery {
  sort: SortKey;
  direction: SortDirection;
  search: string;
  filter: FilterKey;
  view: ViewKey | null;
  group: GroupKey;
}

export interface DashboardCatalog {
  projects: DashboardProject[];
  hiddenCount: number;
  totalCount: number;
  scan: ScanRun | null;
  generatedAt: string;
}

export interface DashboardPageModel extends DashboardCatalog {
  query: DashboardQuery;
  visibleProjects: DashboardProject[];
  viewCounts: Record<ViewKey, number>;
  loadError: string | null;
}

function member<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.includes(value);
}

export function parseDashboardQuery(params: URLSearchParams): DashboardQuery {
  const rawSort = params.get('sort');
  const rawDirection = params.get('dir');
  const rawFilter = params.get('filter');
  const rawView = params.get('view');
  const rawGroup = params.get('group');
  return {
    sort: member(sortKeys, rawSort) ? rawSort : 'latestCommit',
    direction: rawDirection === 'asc' ? 'asc' : 'desc',
    search: (params.get('q') ?? '').slice(0, 200),
    filter: member(filterKeys, rawFilter) ? rawFilter : 'all',
    view: member(viewKeys, rawView) ? rawView : null,
    group: member(groupKeys, rawGroup) ? rawGroup : 'favorites'
  };
}

function daysSince(value: string | null, now: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 86_400_000) : null;
}

function starDelta30d(
  snapshots: readonly MetricSnapshot[],
  current: number | null,
  now: number
): number | null {
  if (current === null) return null;
  const cutoff = now - 30 * 86_400_000;
  const candidates = snapshots
    .filter(
      (snapshot) => snapshot.metric === 'github_stars' && Date.parse(snapshot.capturedOn) <= cutoff
    )
    .sort((left, right) => Date.parse(right.capturedOn) - Date.parse(left.capturedOn));
  return candidates[0] ? current - candidates[0].value : null;
}

export function classifyProject(
  project: Omit<DashboardProject, 'views'>,
  now = Date.now()
): ViewKey[] {
  const metrics = project.metrics;
  const latestAge = daysSince(metrics?.latestCommitAt ?? null, now);
  const oldestPrAge = daysSince(metrics?.githubOldestExternalPrAt ?? null, now);
  const commits30d = metrics?.commits30d ?? 0;
  const views: ViewKey[] = [];
  if (
    project.isMissing ||
    project.errors.length > 0 ||
    metrics?.githubCiState === 'failure' ||
    (metrics?.tdBlockedCount ?? 0) > 0 ||
    (metrics?.tdStaleCount ?? 0) > 0 ||
    (oldestPrAge ?? 0) >= 30
  )
    views.push('attention');
  if ((project.githubStarsGained30d ?? 0) > 0 || (metrics?.githubExternalIssues30d ?? 0) > 0)
    views.push('rising');
  if (
    (metrics?.locCode ?? Infinity) <= 5_000 &&
    ((metrics?.tdTotalNonClosedCount ?? 0) > 0 || (metrics?.githubStars ?? 0) > 0)
  )
    views.push('quickwin');
  if ((metrics?.githubStars ?? 0) > 0 && commits30d <= 5) views.push('opportunity');
  if (
    commits30d >= 10 ||
    (metrics?.activeDays30d ?? 0) >= 5 ||
    (metrics?.githubMergedPrs30d ?? 0) > 0
  )
    views.push('momentum');
  if (commits30d === 0 && (latestAge === null || latestAge >= 90)) views.push('dormant');
  return views;
}

export function readDashboardCatalog(
  repository: CatalogRepository,
  now = new Date()
): DashboardCatalog {
  const allProjects = repository.listProjects({ includeHidden: true });
  const projects = allProjects
    .filter((project) => !project.isHidden)
    .map((project) => {
      const metrics = repository.getMetrics(project.id);
      const snapshots = repository.listSnapshots(project.id);
      const base = {
        ...project,
        metrics,
        snapshots,
        errors: repository.listCollectionErrors(project.id, true),
        githubStarsGained30d: starDelta30d(snapshots, metrics?.githubStars ?? null, now.getTime())
      };
      return { ...base, views: classifyProject(base, now.getTime()) };
    });
  return {
    projects,
    hiddenCount: allProjects.length - projects.length,
    totalCount: allProjects.length,
    scan: repository.getLatestScanRun(),
    generatedAt: now.toISOString()
  };
}

export function applyDashboardQuery(
  projects: readonly DashboardProject[],
  query: DashboardQuery
): DashboardProject[] {
  const needle = query.search.trim().toLocaleLowerCase('en');
  let visible = projects.filter((project) => {
    if (
      needle &&
      !`${project.name}\n${project.relativePath}\n${project.note}`
        .toLocaleLowerCase('en')
        .includes(needle)
    )
      return false;
    if (query.view && !project.views.includes(query.view)) return false;
    if (query.filter === 'favorites' && !project.isFavorite) return false;
    if (query.filter === 'missing' && !project.isMissing) return false;
    if (
      query.filter === 'warnings' &&
      project.errors.length === 0 &&
      !project.views.includes('attention')
    )
      return false;
    if (query.filter === 'local' && project.metrics?.githubRepoId) return false;
    return true;
  });
  visible = sortProjects(visible, query.sort, query.direction) as DashboardProject[];
  if (query.group === 'favorites') {
    visible = [...visible].sort(
      (left, right) => Number(right.isFavorite) - Number(left.isFavorite)
    );
  }
  return visible;
}

export function createPageModel(
  catalog: DashboardCatalog,
  query: DashboardQuery,
  loadError: string | null = null
): DashboardPageModel {
  const viewCounts = Object.fromEntries(
    viewKeys.map((view) => [
      view,
      catalog.projects.filter((project) => project.views.includes(view)).length
    ])
  ) as Record<ViewKey, number>;
  return {
    ...catalog,
    query,
    visibleProjects: applyDashboardQuery(catalog.projects, query),
    viewCounts,
    loadError
  };
}

export function emptyDashboardCatalog(now = new Date()): DashboardCatalog {
  return {
    projects: [],
    hiddenCount: 0,
    totalCount: 0,
    scan: null,
    generatedAt: now.toISOString()
  };
}
