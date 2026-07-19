import { runCommand, type CommandRunner } from '$lib/server/collectors/process';

export type GitHubFailure = 'unauthenticated' | 'rate_limited' | 'unavailable' | 'error';

export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly failure: GitHubFailure,
    readonly status: number | null = null,
    readonly resetAt: string | null = null
  ) {
    super(message);
    this.name = 'GitHubRequestError';
  }
}

export interface GitHubGraphqlError {
  message: string;
  path?: readonly (string | number)[];
  type?: string;
  extensions?: Record<string, unknown>;
}

export interface GitHubGraphqlResult<T> {
  data: T;
  errors?: readonly GitHubGraphqlError[];
}

export interface GitHubRestResult<T> {
  data: T;
  headers: Headers;
}

export interface GitHubClient {
  availability(signal?: AbortSignal): Promise<'available' | 'unauthenticated' | 'rate_limited'>;
  graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<GitHubGraphqlResult<T>>;
  rest<T>(path: string, signal?: AbortSignal): Promise<GitHubRestResult<T>>;
}

export interface GitHubHttpClientOptions {
  env?: Record<string, string | undefined>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  runner?: CommandRunner;
  now?: () => Date;
  apiUrl?: string;
}

function resetFrom(headers: Headers, now: Date): string | null {
  const epoch = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch * 1_000).toISOString();
  const retry = Number(headers.get('retry-after'));
  return Number.isFinite(retry) && retry >= 0
    ? new Date(now.getTime() + retry * 1_000).toISOString()
    : null;
}

function stringReset(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function graphqlReset<T>(
  result: GitHubGraphqlResult<T>,
  headers: Headers,
  now: Date
): string | null {
  const data = result.data as Record<string, unknown> | null;
  const rateLimit = data?.rateLimit as Record<string, unknown> | undefined;
  for (const error of result.errors ?? []) {
    const reset = stringReset(error.extensions?.resetAt);
    if (reset) return reset;
  }
  return stringReset(rateLimit?.resetAt) ?? resetFrom(headers, now);
}

function isRateLimitError(error: GitHubGraphqlError): boolean {
  const code = error.extensions?.code ?? error.extensions?.type;
  return error.type === 'RATE_LIMITED' || code === 'RATE_LIMITED' || code === 'RATE_LIMIT';
}

function requestError(response: Response, now: Date): GitHubRequestError {
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (response.status === 429 || (response.status === 403 && remaining === '0')) {
    return new GitHubRequestError(
      'GitHub rate limit reached',
      'rate_limited',
      response.status,
      resetFrom(response.headers, now)
    );
  }
  if (response.status === 401)
    return new GitHubRequestError('GitHub authentication is invalid', 'unauthenticated', 401);
  if (response.status === 403 || response.status === 404)
    return new GitHubRequestError('GitHub resource is unavailable', 'unavailable', response.status);
  return new GitHubRequestError(
    `GitHub request failed (${response.status})`,
    'error',
    response.status
  );
}

export class GitHubHttpClient implements GitHubClient {
  private readonly env: Record<string, string | undefined>;
  private readonly fetcher: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;
  private readonly runner: CommandRunner;
  private readonly now: () => Date;
  private readonly apiUrl: string;
  private tokenPromise: Promise<string | null> | null = null;
  private limitedUntil = 0;

  private rememberRateLimit(resetAt: string | null): void {
    if (!resetAt) return;
    const parsed = Date.parse(resetAt);
    if (Number.isFinite(parsed)) this.limitedUntil = Math.max(this.limitedUntil, parsed);
  }

  constructor(options: GitHubHttpClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetcher = options.fetch ?? fetch;
    this.runner = options.runner ?? runCommand;
    this.now = options.now ?? (() => new Date());
    this.apiUrl = options.apiUrl ?? 'https://api.github.com';
  }

  private token(): Promise<string | null> {
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const fromEnvironment = this.env.GH_TOKEN || this.env.GITHUB_TOKEN;
      if (fromEnvironment?.trim()) return fromEnvironment.trim();
      const result = await this.runner(['gh', 'auth', 'token'], {
        cwd: process.cwd(),
        timeoutMs: 5_000
      });
      return result.exitCode === 0 && !result.timedOut && !result.aborted && result.stdout.trim()
        ? result.stdout.trim()
        : null;
    })();
    return this.tokenPromise;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    if (this.limitedUntil > this.now().getTime())
      throw new GitHubRequestError(
        'GitHub rate limit reached',
        'rate_limited',
        429,
        new Date(this.limitedUntil).toISOString()
      );
    const token = await this.token();
    if (!token)
      throw new GitHubRequestError('GitHub authentication is required', 'unauthenticated');
    const response = await this.fetcher(`${this.apiUrl}${path}`, {
      ...init,
      signal,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        ...init.headers
      }
    });
    if (!response.ok) {
      const error = requestError(response, this.now());
      if (error.failure === 'rate_limited') this.rememberRateLimit(error.resetAt);
      throw error;
    }
    return response;
  }

  async availability(
    signal?: AbortSignal
  ): Promise<'available' | 'unauthenticated' | 'rate_limited'> {
    if (!(await this.token())) return 'unauthenticated';
    try {
      await this.request('/user', { method: 'GET' }, signal);
      return 'available';
    } catch (error) {
      if (error instanceof GitHubRequestError && error.failure === 'unauthenticated')
        return 'unauthenticated';
      if (error instanceof GitHubRequestError && error.failure === 'rate_limited')
        return 'rate_limited';
      throw error;
    }
  }

  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<GitHubGraphqlResult<T>> {
    const response = await this.request(
      '/graphql',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
      },
      signal
    );
    const result = (await response.json()) as GitHubGraphqlResult<T>;
    const headerLimited = response.headers.get('x-ratelimit-remaining') === '0';
    const bodyRateLimit = result.errors?.some(isRateLimitError) ?? false;
    const data = result.data as Record<string, unknown> | null;
    const rateLimit = data?.rateLimit as Record<string, unknown> | undefined;
    const dataLimited = rateLimit?.remaining === 0;
    if (headerLimited || bodyRateLimit || dataLimited) {
      const resetAt = graphqlReset(result, response.headers, this.now());
      this.rememberRateLimit(resetAt);
      throw new GitHubRequestError('GitHub rate limit reached', 'rate_limited', 200, resetAt);
    }
    if (result.errors?.some((error) => !error.path?.length))
      throw new GitHubRequestError('GitHub GraphQL request failed', 'error', 200);
    return result;
  }

  async rest<T>(path: string, signal?: AbortSignal): Promise<GitHubRestResult<T>> {
    const response = await this.request(path, { method: 'GET' }, signal);
    return { data: (await response.json()) as T, headers: response.headers };
  }
}
