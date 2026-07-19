import type { HostingMetrics, HostingMetricsProvider, TrafficMetrics } from '$lib/domain/providers';
import type { ProviderAvailability, WorkflowState } from '$lib/domain/metrics';
import { GitHubRequestError, type GitHubClient, type GitHubGraphqlError } from './client';

export interface GitHubRepositoryRef {
  owner: string;
  name: string;
  repositoryId?: string | null;
}

interface GraphRepository {
  id: string;
  name: string;
  owner: { login: string };
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  isArchived: boolean;
  stargazerCount: number;
  forkCount: number;
  watchers: { totalCount: number };
  issues: { totalCount: number };
  pullRequests: {
    totalCount: number;
    nodes: { isDraft: boolean; createdAt: string; author: { login: string } | null }[];
  };
  defaultBranchRef: { name: string } | null;
}

interface SearchCount {
  issueCount: number;
  nodes?: { createdAt: string }[];
}

type BatchData = Record<string, GraphRepository | SearchCount | null>;

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
    private readonly now: () => Date = () => new Date()
  ) {}

  availability(signal?: AbortSignal): Promise<ProviderAvailability> {
    return this.client.availability(signal);
  }

  async collect(owner: string, name: string, signal?: AbortSignal): Promise<HostingMetrics> {
    const results = await this.collectMany([{ owner, name }], signal);
    const result = results.get(`${owner}/${name}`);
    if (result instanceof Error) throw result;
    if (!result) throw new GitHubRequestError('GitHub repository is unavailable', 'unavailable');
    return result;
  }

  async collectMany(
    refs: readonly GitHubRepositoryRef[],
    signal?: AbortSignal
  ): Promise<Map<string, HostingMetrics | Error>> {
    const date30 = queryDate(this.now(), 30);
    const date90 = queryDate(this.now(), 90);
    const fragments = refs.map((ref, index) => {
      const repository = ref.repositoryId
        ? `node(id:${gqlString(ref.repositoryId)}) { ... on Repository { ...RepoFields } }`
        : `repository(owner:${gqlString(ref.owner)},name:${gqlString(ref.name)}) { ...RepoFields }`;
      const repo = `repo:${gqlString(`${ref.owner}/${ref.name}`)}`;
      return `r${index}: ${repository}
        d_${index}: search(query:${gqlString(`${repo} is:pr is:open draft:true`)},type:ISSUE){issueCount}
        y_${index}: search(query:${gqlString(`${repo} is:pr is:open draft:false`)},type:ISSUE){issueCount}
        o_${index}: search(query:${gqlString(`${repo} is:pr is:open author:${ref.owner}`)},type:ISSUE){issueCount}
        x_${index}: search(query:${gqlString(`${repo} is:pr is:open -author:${ref.owner} sort:created-asc`)},type:ISSUE){issueCount nodes{... on PullRequest{createdAt}}}
        m30_${index}: search(query:${gqlString(`${repo} is:pr is:merged merged:>=${date30}`)},type:ISSUE){issueCount}
        m90_${index}: search(query:${gqlString(`${repo} is:pr is:merged merged:>=${date90}`)},type:ISSUE){issueCount}
        e30_${index}: search(query:${gqlString(`${repo} is:issue created:>=${date30} -author:${ref.owner}`)},type:ISSUE){issueCount}
        e90_${index}: search(query:${gqlString(`${repo} is:issue created:>=${date90} -author:${ref.owner}`)},type:ISSUE){issueCount}`;
    });
    const query = `query { ${fragments.join('\n')} }
      fragment RepoFields on Repository {
        id name owner{login} visibility isArchived stargazerCount forkCount watchers{totalCount}
        issues(states:OPEN){totalCount}
        pullRequests(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:ASC}){
          totalCount nodes{isDraft createdAt author{login}}
        }
        defaultBranchRef{name}
      }`;
    const response = await this.client.graphql<BatchData>(query, {}, signal);
    const results = new Map<string, HostingMetrics | Error>();
    await Promise.all(
      refs.map(async (ref, index) => {
        const key = `${ref.owner}/${ref.name}`;
        const repository = response.data[`r${index}`] as GraphRepository | null;
        if (!repository || errorForAlias(response.errors, `r${index}`)) {
          results.set(
            key,
            new GitHubRequestError('GitHub repository is unavailable', 'unavailable')
          );
          return;
        }
        const pullRequests = repository.pullRequests.nodes;
        const external = pullRequests.filter(
          (pullRequest) =>
            pullRequest.author?.login.toLowerCase() !== repository.owner.login.toLowerCase()
        );
        const ready = pullRequests.filter((pullRequest) => !pullRequest.isDraft).length;
        const draftSearch = response.data[`d_${index}`] as SearchCount | null;
        const readySearch = response.data[`y_${index}`] as SearchCount | null;
        const ownerSearch = response.data[`o_${index}`] as SearchCount | null;
        const externalSearch = response.data[`x_${index}`] as SearchCount | null;
        const base: HostingMetrics = {
          repositoryId: repository.id,
          owner: repository.owner.login,
          name: repository.name,
          visibility: repository.visibility.toLowerCase() as HostingMetrics['visibility'],
          isArchived: repository.isArchived,
          stars: repository.stargazerCount,
          forks: repository.forkCount,
          watchers: repository.watchers.totalCount,
          openIssues: repository.issues.totalCount,
          openPullRequests: repository.pullRequests.totalCount,
          draftPullRequests:
            draftSearch?.issueCount ?? pullRequests.filter(({ isDraft }) => isDraft).length,
          readyPullRequests: readySearch?.issueCount ?? ready,
          ownerPullRequests: ownerSearch?.issueCount ?? pullRequests.length - external.length,
          externalPullRequests: externalSearch?.issueCount ?? external.length,
          oldestExternalPullRequestAt:
            externalSearch?.nodes?.[0]?.createdAt ?? external[0]?.createdAt ?? null,
          mergedPullRequests30d:
            (response.data[`m30_${index}`] as SearchCount | null)?.issueCount ?? 0,
          mergedPullRequests90d:
            (response.data[`m90_${index}`] as SearchCount | null)?.issueCount ?? 0,
          externalIssues30d: (response.data[`e30_${index}`] as SearchCount | null)?.issueCount ?? 0,
          externalIssues90d: (response.data[`e90_${index}`] as SearchCount | null)?.issueCount ?? 0,
          latestReleaseAt: null,
          latestReleaseTag: null,
          releaseDownloads: null,
          workflowState: 'unknown',
          contributorCount: null
        };
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
        base.workflowState = workflowState(workflows?.data.workflow_runs[0]);
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
      if (error instanceof GitHubRequestError && error.failure === 'unavailable') return null;
      throw error;
    }
  }

  async collectTraffic(owner: string, name: string, signal?: AbortSignal): Promise<TrafficMetrics> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/traffic`;
    try {
      const [views, clones] = await Promise.all([
        this.client.rest<TrafficResponse>(`${path}/views`, signal),
        this.client.rest<TrafficResponse>(`${path}/clones`, signal)
      ]);
      return {
        availability: 'available',
        views: views.data.count,
        uniqueVisitors: views.data.uniques,
        clones: clones.data.count,
        uniqueCloners: clones.data.uniques
      };
    } catch (error) {
      if (error instanceof GitHubRequestError && error.failure === 'unavailable')
        return {
          availability: 'unavailable',
          views: null,
          uniqueVisitors: null,
          clones: null,
          uniqueCloners: null
        };
      throw error;
    }
  }
}
