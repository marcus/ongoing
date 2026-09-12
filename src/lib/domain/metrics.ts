export type ProviderAvailability = 'available' | 'unavailable' | 'unauthenticated' | 'rate_limited';
export type RepositoryVisibility = 'public' | 'private' | 'internal';
export type WorkflowState = 'success' | 'failure' | 'pending' | 'neutral' | 'unknown';

export interface ProjectMetrics {
  projectId: string;
  headSha: string | null;
  branch: string | null;
  latestCommitAt: string | null;
  latestCommitSubject: string | null;
  latestCommitShortSha: string | null;
  commitCount: number | null;
  commits7d: number | null;
  commits30d: number | null;
  commits90d: number | null;
  activeDays30d: number | null;
  activeDays90d: number | null;
  churnAdded30d: number | null;
  churnDeleted30d: number | null;
  churnAdded90d: number | null;
  churnDeleted90d: number | null;
  contributorCount: number | null;
  localAuthorCommitShare30d: number | null;
  dirtyFiles: number | null;
  aheadCount: number | null;
  behindCount: number | null;
  latestTag: string | null;
  commitsSinceLatestTag: number | null;
  locCode: number | null;
  locComment: number | null;
  locBlank: number | null;
  locFiles: number | null;
  locTest: number | null;
  dominantLanguage: string | null;
  locFingerprint: string | null;
  tdOpenCount: number | null;
  tdInProgressCount: number | null;
  tdBlockedCount: number | null;
  tdReviewCount: number | null;
  tdTotalNonClosedCount: number | null;
  tdStaleCount: number | null;
  githubRepoId: string | null;
  githubOwner: string | null;
  githubName: string | null;
  githubVisibility: RepositoryVisibility | null;
  githubIsArchived: boolean | null;
  githubStars: number | null;
  githubForks: number | null;
  githubWatchers: number | null;
  githubOpenIssues: number | null;
  githubOpenPrs: number | null;
  githubDraftPrs: number | null;
  githubReadyPrs: number | null;
  githubOwnerPrs: number | null;
  githubExternalPrs: number | null;
  githubOldestExternalPrAt: string | null;
  githubMergedPrs30d: number | null;
  githubMergedPrs90d: number | null;
  githubExternalIssues30d: number | null;
  githubExternalIssues90d: number | null;
  githubLatestReleaseAt: string | null;
  githubLatestReleaseTag: string | null;
  githubReleaseDownloads: number | null;
  githubCiState: WorkflowState | null;
  githubContributorCount: number | null;
  githubTrafficViews: number | null;
  githubTrafficUniqueVisitors: number | null;
  githubTrafficClones: number | null;
  githubTrafficUniqueCloners: number | null;
  githubAvailability: ProviderAvailability | null;
  githubTrafficAvailability: ProviderAvailability | null;
  gitScannedAt: string | null;
  locScannedAt: string | null;
  stackScannedAt: string | null;
  tdScannedAt: string | null;
  githubScannedAt: string | null;
  githubTrafficScannedAt: string | null;
}

export const snapshotMetrics = [
  'github_stars',
  'loc_code',
  'github_traffic_views',
  'github_traffic_unique_visitors',
  'github_traffic_clones',
  'github_traffic_unique_cloners',
  'github_open_issues',
  'github_open_prs'
] as const;

export type SnapshotMetric = (typeof snapshotMetrics)[number];

export interface MetricSnapshot {
  projectId: string;
  metric: SnapshotMetric;
  capturedOn: string;
  value: number;
}

export const collectors = [
  'discovery',
  'git',
  'loc',
  'issues',
  'hosting',
  'traffic',
  'stack'
] as const;
export type Collector = (typeof collectors)[number];

export interface CollectionError {
  projectId: string;
  collector: Collector;
  message: string;
  occurredAt: string;
  resolvedAt: string | null;
}

export type ScanReason = 'startup' | 'scheduled' | 'manual' | 'project' | 'cli';
export type ScanStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScanRun {
  id: string;
  reason: ScanReason;
  status: ScanStatus;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  updatedCount: number;
  errorCount: number;
}

/**
 * The change in a snapshot metric over the last 30 days: the current value minus the newest
 * snapshot at or before the cutoff. Pure, so the read model, the dashboard, and the browser all
 * compute the same delta from the same rows.
 */
export function metricDelta30d(
  snapshots: readonly MetricSnapshot[],
  metric: SnapshotMetric,
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
