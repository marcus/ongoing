import type { ProviderAvailability, RepositoryVisibility, WorkflowState } from './metrics';

export interface IssueMetrics {
  openCount: number;
  inProgressCount: number;
  blockedCount: number;
  reviewCount: number;
  totalNonClosedCount: number;
  staleCount: number;
}

export interface HostingMetrics {
  repositoryId: string;
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
  isArchived: boolean;
  stars: number;
  forks: number;
  watchers: number | null;
  openIssues: number;
  openPullRequests: number;
  draftPullRequests: number;
  readyPullRequests: number;
  ownerPullRequests: number;
  externalPullRequests: number;
  oldestExternalPullRequestAt: string | null;
  mergedPullRequests30d: number;
  mergedPullRequests90d: number;
  externalIssues30d: number;
  externalIssues90d: number;
  latestReleaseAt: string | null;
  latestReleaseTag: string | null;
  releaseDownloads: number | null;
  workflowState: WorkflowState;
  contributorCount: number | null;
}

export interface TrafficMetrics {
  availability: ProviderAvailability;
  views: number | null;
  uniqueVisitors: number | null;
  clones: number | null;
  uniqueCloners: number | null;
}

export interface IssueMetricsProvider {
  collect(projectPath: string, signal?: AbortSignal): Promise<IssueMetrics>;
}

export interface HostingMetricsProvider {
  availability(signal?: AbortSignal): Promise<ProviderAvailability>;
  collect(owner: string, name: string, signal?: AbortSignal): Promise<HostingMetrics>;
  collectTraffic(owner: string, name: string, signal?: AbortSignal): Promise<TrafficMetrics>;
}
