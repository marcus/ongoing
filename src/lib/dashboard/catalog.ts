import type { CollectionError, MetricSnapshot, ScanRun } from '$lib/domain/metrics';
import {
  attentionViewKeys,
  classifyAttentionViews,
  type AttentionClassifications
} from '$lib/domain/attention';
import {
  sortKeys,
  sortProjects,
  type SortableProject,
  type SortDirection,
  type SortKey
} from '$lib/domain/sorting';
import {
  resolveStack,
  toolchainKeys,
  type Toolchain,
  type ToolchainBaselineStatus,
  type ToolchainRelease
} from '$lib/domain/stack';
import type { CatalogRepository } from '$lib/server/catalog/repository';

export const viewKeys = attentionViewKeys;
export const filterKeys = ['all', 'favorites', 'missing', 'warnings', 'local'] as const;
export const groupKeys = ['none', 'favorites'] as const;

export type ViewKey = (typeof viewKeys)[number];
export type FilterKey = (typeof filterKeys)[number];
export type GroupKey = (typeof groupKeys)[number];

export interface DashboardProject extends SortableProject {
  errors: CollectionError[];
  snapshots: MetricSnapshot[];
  views: ViewKey[];
  attention: AttentionClassifications;
  githubTrafficViewsDelta30d: number | null;
  githubTrafficClonesDelta30d: number | null;
}

export interface DashboardQuery {
  sort: SortKey;
  direction: SortDirection;
  search: string;
  filter: FilterKey;
  view: ViewKey | null;
  stack: Toolchain | null;
  group: GroupKey;
}

export interface DashboardCatalog {
  projects: DashboardProject[];
  hiddenCount: number;
  totalCount: number;
  scan: ScanRun | null;
  baselines: ToolchainBaselineStatus[];
  generatedAt: string;
}

export interface DashboardPageModel extends DashboardCatalog {
  query: DashboardQuery;
  visibleProjects: DashboardProject[];
  viewCounts: Record<ViewKey, number>;
  loadError: string | null;
}

function dashboardProject(
  repository: CatalogRepository,
  project: ReturnType<CatalogRepository['listProjects']>[number],
  now: Date,
  releases: ReadonlyMap<Toolchain, ToolchainRelease[]>,
  declarations: ReadonlyMap<string, ReturnType<CatalogRepository['listProjectStacks']>>
): DashboardProject {
  const metrics = repository.getMetrics(project.id);
  const snapshots = repository.listSnapshots(project.id);
  const base = {
    ...project,
    metrics,
    snapshots,
    // Resolved here rather than persisted so the classifier stays a pure function of the project
    // and can be re-run in the browser after an optimistic edit.
    stacks: (declarations.get(project.id) ?? []).map((stack) =>
      resolveStack(stack, releases.get(stack.toolchain) ?? [], now.getTime())
    ),
    errors: repository.listCollectionErrors(project.id, true),
    githubStarsGained30d: metricDelta30d(
      snapshots,
      'github_stars',
      metrics?.githubStars ?? null,
      now.getTime()
    ),
    githubTrafficViewsDelta30d: metricDelta30d(
      snapshots,
      'github_traffic_views',
      metrics?.githubTrafficViews ?? null,
      now.getTime()
    ),
    githubTrafficClonesDelta30d: metricDelta30d(
      snapshots,
      'github_traffic_clones',
      metrics?.githubTrafficClones ?? null,
      now.getTime()
    )
  };
  const attention = classifyAttentionViews(base, now.getTime());
  return {
    ...base,
    attention,
    views: viewKeys.filter((key) => attention[key].member)
  };
}

function member<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.includes(value);
}

export function parseDashboardQuery(params: URLSearchParams): DashboardQuery {
  const rawSort = params.get('sort');
  const rawDirection = params.get('dir');
  const rawFilter = params.get('filter');
  const rawView = params.get('view');
  const rawStack = params.get('stack');
  const rawGroup = params.get('group');
  return {
    sort: member(sortKeys, rawSort) ? rawSort : 'latestCommit',
    direction: rawDirection === 'asc' ? 'asc' : 'desc',
    search: (params.get('q') ?? '').slice(0, 200),
    filter: member(filterKeys, rawFilter) ? rawFilter : 'all',
    view: member(viewKeys, rawView) ? rawView : null,
    stack: member(toolchainKeys, rawStack) ? rawStack : null,
    group: member(groupKeys, rawGroup) ? rawGroup : 'favorites'
  };
}

/** Toolchains present in a catalog, with how many projects declare each, for filter controls. */
export function stackCounts(
  projects: readonly DashboardProject[]
): { key: Toolchain; count: number }[] {
  const counts = new Map<Toolchain, number>();
  for (const project of projects)
    for (const toolchain of new Set(project.stacks.map((stack) => stack.toolchain)))
      counts.set(toolchain, (counts.get(toolchain) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'en'));
}

export function metricDelta30d(
  snapshots: readonly MetricSnapshot[],
  metric: MetricSnapshot['metric'],
  current: number | null,
  now: number
): number | null {
  if (current === null) return null;
  const cutoff = now - 30 * 86_400_000;
  const candidates = snapshots
    .filter((snapshot) => snapshot.metric === metric && Date.parse(snapshot.capturedOn) <= cutoff)
    .sort((left, right) => Date.parse(right.capturedOn) - Date.parse(left.capturedOn));
  return candidates[0] ? current - candidates[0].value : null;
}

export function classifyProject(
  project: Omit<DashboardProject, 'views' | 'attention'>,
  now = Date.now()
): ViewKey[] {
  const classifications = classifyAttentionViews(project, now);
  return viewKeys.filter((key) => classifications[key].member);
}

function readCatalog(repository: CatalogRepository, hidden: boolean, now: Date): DashboardCatalog {
  const allProjects = repository.listProjects({ includeHidden: true });
  // Release cycles and declarations are read once for the whole catalog rather than per project.
  const releases = repository.listToolchainReleases();
  const declarations = repository.listAllProjectStacks();
  const projects = allProjects
    .filter((project) => project.isHidden === hidden)
    .map((project) => dashboardProject(repository, project, now, releases, declarations));
  return {
    projects,
    hiddenCount: hidden ? projects.length : allProjects.length - projects.length,
    totalCount: allProjects.length,
    scan: repository.getLatestScanRun(),
    baselines: repository.listBaselineStatus(),
    generatedAt: now.toISOString()
  };
}

export function readDashboardCatalog(
  repository: CatalogRepository,
  now = new Date()
): DashboardCatalog {
  return readCatalog(repository, false, now);
}

/** The hidden shelf as a full catalog, so API clients get the same shape as the dashboard. */
export function readHiddenCatalog(
  repository: CatalogRepository,
  now = new Date()
): DashboardCatalog {
  return readCatalog(repository, true, now);
}

export function readHiddenProjects(
  repository: CatalogRepository,
  now = new Date()
): DashboardProject[] {
  return readHiddenCatalog(repository, now).projects;
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
    if (query.stack && !project.stacks.some(({ toolchain }) => toolchain === query.stack))
      return false;
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
    baselines: [],
    generatedAt: now.toISOString()
  };
}
