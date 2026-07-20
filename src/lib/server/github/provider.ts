import type { HostingMetrics, HostingMetricsProvider, TrafficMetrics } from '$lib/domain/providers';
import type { ProviderAvailability, WorkflowState } from '$lib/domain/metrics';
import { GitHubRequestError, type GitHubClient, type GitHubGraphqlError } from './client';

export interface GitHubRepositoryRef {
  owner: string;
  name: string;
  repositoryId?: string | null;
}

export type GitHubHostingMetrics = Pick<HostingMetrics, 'repositoryId' | 'owner' | 'name'> &
  Partial<Omit<HostingMetrics, 'repositoryId' | 'owner' | 'name'>> & {
    graphqlComplete: boolean;
  };

export function clampGitHubPageSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

interface GraphRepository {
  id: string;
  name: string;
  owner: { login: string };
  visibility?: 'PUBLIC' | 'PRIVATE' | 'INTERNAL' | null;
  isArchived?: boolean | null;
  stargazerCount?: number | null;
  forkCount?: number | null;
  watchers?: { totalCount: number } | null;
  issues?: { totalCount: number } | null;
  pullRequests?: { totalCount: number } | null;
  defaultBranchRef: { name: string } | null;
}

interface SearchCount {
  issueCount: number;
  nodes?: { createdAt: string }[];
}

type BatchData = Record<string, GraphRepository | SearchCount | null | undefined>;

const MAX_GRAPHQL_BATCH_SIZE = 2;

interface Release {
  published_at: string | null;
  tag_name: string;
  assets: { download_count: number }[];
}

interface WorkflowRuns {
  workflow_runs: { conclusion: string | null; status: string }[];
}

interface TrafficResponse {
  count: number;
  uniques: number;
}

function queryDate(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function gqlString(value: string): string {
  return JSON.stringify(value);
}

function errorForAlias(errors: readonly GitHubGraphqlError[] | undefined, alias: string): boolean {
  return errors?.some((error) => error.path?.[0] === alias) ?? false;
}

function rootErrorForAlias(
  errors: readonly GitHubGraphqlError[] | undefined,
  alias: string
): boolean {
  return errors?.some((error) => error.path?.length === 1 && error.path[0] === alias) ?? false;
}

function isServerFailure(error: unknown): error is GitHubRequestError {
  return (
    error instanceof GitHubRequestError &&
    error.failure === 'error' &&
    error.status !== null &&
    error.status >= 500 &&
    error.status < 600
  );
}

function workflowState(run: WorkflowRuns['workflow_runs'][number] | undefined): WorkflowState {
  if (!run) return 'unknown';
  if (run.status !== 'completed') return 'pending';
  if (run.conclusion === 'success') return 'success';
  if (['failure', 'timed_out', 'cancelled', 'action_required'].includes(run.conclusion ?? ''))
    return 'failure';
  return 'neutral';
}

function lastPage(headers: Headers, currentLength: number): number {
  const link = headers.get('link');
  const match = link?.match(/[?&]page=(\d+)>; rel="last"/);
  return match ? Number(match[1]) : currentLength;
}

export class GitHubHostingMetricsProvider implements HostingMetricsProvider {
  constructor(
    private readonly client: GitHubClient,
    private readonly now: () => Date = () => new Date(),
    private readonly pageSizes: { connection?: number; pullRequests?: number } = {}
  ) {}

  availability(signal?: AbortSignal): Promise<ProviderAvailability> {
    return this.client.availability(signal);
  }

  async collect(owner: string, name: string, signal?: AbortSignal): Promise<HostingMetrics> {
    const results = await this.collectMany([{ owner, name }], signal);
    const result = results.get(`${owner}/${name}`);
    if (result instanceof Error) throw result;
    if (!result) throw new GitHubRequestError('GitHub repository is unavailable', 'unavailable');
    const required: (keyof HostingMetrics)[] = [
      'visibility',
      'isArchived',
      'stars',
      'forks',
      'watchers',
      'openIssues',
      'openPullRequests',
      'draftPullRequests',
      'readyPullRequests',
      'ownerPullRequests',
      'externalPullRequests',
      'oldestExternalPullRequestAt',
      'mergedPullRequests30d',
      'mergedPullRequests90d',
      'externalIssues30d',
      'externalIssues90d',
      'latestReleaseAt',
      'latestReleaseTag',
      'releaseDownloads',
      'workflowState',
      'contributorCount'
    ];
    if (required.some((key) => !(key in result)))
      throw new GitHubRequestError('GitHub repository response was incomplete', 'error', 200);
    return result as HostingMetrics;
  }

  async collectMany(
    refs: readonly GitHubRepositoryRef[],
    signal?: AbortSignal
  ): Promise<Map<string, GitHubHostingMetrics | Error>> {
    const results = new Map<string, GitHubHostingMetrics | Error>();
    for (let offset = 0; offset < refs.length; offset += MAX_GRAPHQL_BATCH_SIZE) {
      if (signal?.aborted) throw signal.reason;
      const batch = refs.slice(offset, offset + MAX_GRAPHQL_BATCH_SIZE);
      const batchResults = await this.collectBatchWithIsolation(batch, signal);
      for (const ref of batch) {
        const key = `${ref.owner}/${ref.name}`;
        const result = batchResults.get(key);
        if (result) results.set(key, result);
      }
    }
    return results;
  }

  private async collectBatchWithIsolation(
    refs: readonly GitHubRepositoryRef[],
    signal?: AbortSignal
  ): Promise<Map<string, GitHubHostingMetrics | Error>> {
    try {
      return await this.collectBatch(refs, signal);
    } catch (error) {
      if (!isServerFailure(error)) throw error;
      if (refs.length === 1) return new Map([[`${refs[0].owner}/${refs[0].name}`, error]]);

      const isolated = new Map<string, GitHubHostingMetrics | Error>();
      for (const ref of refs) {
        if (signal?.aborted) throw signal.reason;
        const singleton = await this.collectBatchWithIsolation([ref], signal);
        isolated.set(
          `${ref.owner}/${ref.name}`,
          singleton.get(`${ref.owner}/${ref.name}`) ?? error
        );
      }
      return isolated;
    }
  }

  private async collectBatch(
    refs: readonly GitHubRepositoryRef[],
    signal?: AbortSignal
  ): Promise<Map<string, GitHubHostingMetrics | Error>> {
    const date30 = queryDate(this.now(), 30);
    const date90 = queryDate(this.now(), 90);
    const fragments = refs.map((ref, index) => {
      const repository = ref.repositoryId
        ? `node(id:${gqlString(ref.repositoryId)}) { ... on Repository { ...RepoFields } }`
        : `repository(owner:${gqlString(ref.owner)},name:${gqlString(ref.name)}) { ...RepoFields }`;
      const repo = `repo:${gqlString(`${ref.owner}/${ref.name}`)}`;
      return `r${index}: ${repository}
        d_${index}: search(query:${gqlString(`${repo} is:pr is:open draft:true`)},type:ISSUE,first:$connectionPage){issueCount}
        y_${index}: search(query:${gqlString(`${repo} is:pr is:open draft:false`)},type:ISSUE,first:$connectionPage){issueCount}
        o_${index}: search(query:${gqlString(`${repo} is:pr is:open author:${ref.owner}`)},type:ISSUE,first:$connectionPage){issueCount}
        x_${index}: search(query:${gqlString(`${repo} is:pr is:open -author:${ref.owner} sort:created-asc`)},type:ISSUE,first:$connectionPage){issueCount nodes{... on PullRequest{createdAt}}}
        m30_${index}: search(query:${gqlString(`${repo} is:pr is:merged merged:>=${date30}`)},type:ISSUE,first:$connectionPage){issueCount}
        m90_${index}: search(query:${gqlString(`${repo} is:pr is:merged merged:>=${date90}`)},type:ISSUE,first:$connectionPage){issueCount}
        e30_${index}: search(query:${gqlString(`${repo} is:issue created:>=${date30} -author:${ref.owner}`)},type:ISSUE,first:$connectionPage){issueCount}
        e90_${index}: search(query:${gqlString(`${repo} is:issue created:>=${date90} -author:${ref.owner}`)},type:ISSUE,first:$connectionPage){issueCount}`;
    });
    const query = `query($connectionPage:Int!,$pullRequestPage:Int!) { ${fragments.join('\n')} rateLimit{remaining resetAt} }
      fragment RepoFields on Repository {
        id name owner{login} visibility isArchived stargazerCount forkCount watchers(first:$connectionPage){totalCount}
        issues(states:OPEN,first:$connectionPage){totalCount}
        pullRequests(states:OPEN,first:$pullRequestPage){totalCount}
        defaultBranchRef{name}
      }`;
    const response = await this.client.graphql<BatchData>(
      query,
      {
        connectionPage: clampGitHubPageSize(this.pageSizes.connection ?? 1),
        pullRequestPage: clampGitHubPageSize(this.pageSizes.pullRequests ?? 100)
      },
      signal
    );
    const results = new Map<string, GitHubHostingMetrics | Error>();
    await Promise.all(
      refs.map(async (ref, index) => {
        const key = `${ref.owner}/${ref.name}`;
        const repository = response.data[`r${index}`] as GraphRepository | null;
        if (!repository || rootErrorForAlias(response.errors, `r${index}`)) {
          results.set(
            key,
            new GitHubRequestError('GitHub repository is unavailable', 'unavailable')
          );
          return;
        }
        const alias = (name: string): SearchCount | undefined => {
          if (errorForAlias(response.errors, name)) return undefined;
          const value = response.data[name] as SearchCount | null | undefined;
          return value ?? undefined;
        };
        const draftSearch = alias(`d_${index}`);
        const readySearch = alias(`y_${index}`);
        const ownerSearch = alias(`o_${index}`);
        const externalSearch = alias(`x_${index}`);
        const base: GitHubHostingMetrics = {
          repositoryId: repository.id,
          owner: repository.owner.login,
          name: repository.name,
          graphqlComplete: false
        };
        if (repository.visibility)
          base.visibility = repository.visibility.toLowerCase() as HostingMetrics['visibility'];
        if (typeof repository.isArchived === 'boolean') base.isArchived = repository.isArchived;
        if (typeof repository.stargazerCount === 'number') base.stars = repository.stargazerCount;
        if (typeof repository.forkCount === 'number') base.forks = repository.forkCount;
        if (typeof repository.watchers?.totalCount === 'number')
          base.watchers = repository.watchers.totalCount;
        if (typeof repository.issues?.totalCount === 'number')
          base.openIssues = repository.issues.totalCount;
        if (typeof repository.pullRequests?.totalCount === 'number')
          base.openPullRequests = repository.pullRequests.totalCount;
        if (draftSearch) base.draftPullRequests = draftSearch.issueCount;
        if (readySearch) base.readyPullRequests = readySearch.issueCount;
        if (ownerSearch) base.ownerPullRequests = ownerSearch.issueCount;
        if (externalSearch) {
          base.externalPullRequests = externalSearch.issueCount;
          if (externalSearch.issueCount === 0 || externalSearch.nodes?.length)
            base.oldestExternalPullRequestAt = externalSearch.nodes?.[0]?.createdAt ?? null;
        }
        for (const [aliasName, field] of [
          [`m30_${index}`, 'mergedPullRequests30d'],
          [`m90_${index}`, 'mergedPullRequests90d'],
          [`e30_${index}`, 'externalIssues30d'],
          [`e90_${index}`, 'externalIssues90d']
        ] as const) {
          const value = alias(aliasName);
          if (value) base[field] = value.issueCount;
        }
        base.graphqlComplete = [
          'visibility',
          'isArchived',
          'stars',
          'forks',
          'watchers',
          'openIssues',
          'openPullRequests',
          'draftPullRequests',
          'readyPullRequests',
          'ownerPullRequests',
          'externalPullRequests',
          'oldestExternalPullRequestAt',
          'mergedPullRequests30d',
          'mergedPullRequests90d',
          'externalIssues30d',
          'externalIssues90d'
        ].every((field) => field in base);
        const path = `/repos/${encodeURIComponent(base.owner)}/${encodeURIComponent(base.name)}`;
        const [release, workflows, contributors] = await Promise.all([
          this.optionalRest<Release>(`${path}/releases/latest`, signal),
          this.optionalRest<WorkflowRuns>(
            `${path}/actions/runs?branch=${encodeURIComponent(repository.defaultBranchRef?.name ?? '')}&per_page=1`,
            signal
          ),
          this.optionalRest<unknown[]>(`${path}/contributors?anon=1&per_page=1`, signal)
        ]);
        if (release) {
          base.latestReleaseAt = release.data.published_at;
          base.latestReleaseTag = release.data.tag_name;
          base.releaseDownloads = release.data.assets.reduce(
            (sum, asset) => sum + asset.download_count,
            0
          );
        }
        if (workflows) base.workflowState = workflowState(workflows.data.workflow_runs[0]);
        if (contributors)
          base.contributorCount = lastPage(contributors.headers, contributors.data.length);
        results.set(key, base);
      })
    );
    return results;
  }

  private async optionalRest<T>(
    path: string,
    signal?: AbortSignal
  ): Promise<{ data: T; headers: Headers } | null> {
    try {
      return await this.client.rest<T>(path, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
  }

  async collectTraffic(owner: string, name: string, signal?: AbortSignal): Promise<TrafficMetrics> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/traffic`;
    const [views, clones] = await Promise.allSettled([
      this.client.rest<TrafficResponse>(`${path}/views`, signal),
      this.client.rest<TrafficResponse>(`${path}/clones`, signal)
    ]);
    if (signal?.aborted) throw signal.reason;
    const failures = [views, clones]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(({ reason }) => reason);
    if (
      failures.length === 2 &&
      failures.some((failure) => !(failure instanceof GitHubRequestError))
    )
      throw failures.find((failure) => !(failure instanceof GitHubRequestError));
    const typed = failures.filter(
      (failure): failure is GitHubRequestError => failure instanceof GitHubRequestError
    );
    const availability: ProviderAvailability = typed.some(
      ({ failure }) => failure === 'rate_limited'
    )
      ? 'rate_limited'
      : typed.some(({ failure }) => failure === 'unauthenticated')
        ? 'unauthenticated'
        : failures.length
          ? 'unavailable'
          : 'available';
    return {
      availability,
      views: views.status === 'fulfilled' ? views.value.data.count : null,
      uniqueVisitors: views.status === 'fulfilled' ? views.value.data.uniques : null,
      clones: clones.status === 'fulfilled' ? clones.value.data.count : null,
      uniqueCloners: clones.status === 'fulfilled' ? clones.value.data.uniques : null
    };
  }
}
