import type { GitHubClient, GitHubGraphqlResult } from './client';

/**
 * Repository discovery on the hosting provider (Phase 6).
 *
 * The filesystem provider answers "what is checked out here". This answers "what exists over
 * there": the repositories an owner has that may never have been cloned. It is off until
 * configuration names an owner, because listing somebody's account is not something a scan should
 * start doing on its own.
 *
 * One GraphQL query serves users and organisations alike — `repositoryOwner` resolves either — so
 * the caller does not have to know which kind of account a login is.
 */
export interface RemoteRepository {
  owner: string;
  name: string;
  repositoryId: string;
  isArchived: boolean;
  isFork: boolean;
  visibility: 'public' | 'private' | 'internal';
  description: string | null;
}

interface RepositoryConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ({
    id: string;
    name: string;
    owner: { login: string };
    isArchived: boolean | null;
    isFork: boolean | null;
    visibility: string | null;
    description: string | null;
  } | null)[];
}

interface OwnerPage {
  repositoryOwner: { repositories: RepositoryConnection } | null;
}

const PAGE_SIZE = 100;
/** A guard rail, not a preference: a very large account should not turn one scan into a crawl. */
const MAX_PAGES = 20;

const QUERY = `query($login:String!,$cursor:String,$size:Int!){
  repositoryOwner(login:$login){
    repositories(first:$size, after:$cursor, ownerAffiliations:OWNER, orderBy:{field:NAME,direction:ASC}){
      pageInfo{ hasNextPage endCursor }
      nodes{ id name owner{login} isArchived isFork visibility description }
    }
  }
  rateLimit{ remaining resetAt }
}`;

/**
 * Every repository `login` owns, as one list. A login that does not resolve returns an empty list
 * rather than throwing: a typo in configuration should leave the rest of the scan alone, and the
 * caller reports it.
 */
export async function listOwnerRepositories(
  client: GitHubClient,
  login: string,
  signal?: AbortSignal
): Promise<RemoteRepository[]> {
  const repositories: RemoteRepository[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (signal?.aborted) throw signal.reason;
    const result: GitHubGraphqlResult<OwnerPage> = await client.graphql<OwnerPage>(
      QUERY,
      { login, cursor, size: PAGE_SIZE },
      signal
    );
    const connection: RepositoryConnection | undefined = result.data?.repositoryOwner?.repositories;
    if (!connection) break;
    for (const node of connection.nodes) {
      if (!node) continue;
      repositories.push({
        owner: node.owner.login,
        name: node.name,
        repositoryId: node.id,
        isArchived: node.isArchived ?? false,
        isFork: node.isFork ?? false,
        visibility: (node.visibility?.toLowerCase() ?? 'public') as RemoteRepository['visibility'],
        description: node.description ?? null
      });
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }
  return repositories;
}
