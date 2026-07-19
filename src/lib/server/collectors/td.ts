import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IssueMetrics, IssueMetricsProvider } from '$lib/domain/providers';
import { runCommand, type CommandRunner } from './process';

export type HttpClient = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export interface TdCollectionOptions {
  runner?: CommandRunner;
  http?: HttpClient;
  timeoutMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
}

interface TdIssue {
  status: string;
  updated_at: string;
}

const NON_CLOSED_STATUSES = ['open', 'in_progress', 'blocked', 'in_review'] as const;
const DEFAULT_TIMEOUT_MS = 5_000;

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`TD returned an invalid ${label}`);
  return value;
}

function parseDocument(output: string, source: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${source} returned malformed JSON`);
  }
}

function parseIssues(value: unknown, source: string): TdIssue[] {
  // TD encodes an empty CLI list as null. Treat it as the empty collection.
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${source} returned an invalid issue list`);
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error(`${source} returned an invalid issue`);
    const issue = entry as Record<string, unknown>;
    if (typeof issue.status !== 'string' || typeof issue.updated_at !== 'string')
      throw new Error(`${source} returned an invalid issue`);
    return { status: issue.status, updated_at: issue.updated_at };
  });
}

function metricsFromIssues(issues: readonly TdIssue[], now: Date): IssueMetrics {
  const cutoff = now.valueOf() - 30 * 86_400_000;
  const count = (status: string) => issues.filter((issue) => issue.status === status).length;
  return {
    openCount: count('open'),
    inProgressCount: count('in_progress'),
    blockedCount: count('blocked'),
    reviewCount: count('in_review'),
    totalNonClosedCount: issues.filter((issue) =>
      NON_CLOSED_STATUSES.includes(issue.status as (typeof NON_CLOSED_STATUSES)[number])
    ).length,
    staleCount: issues.filter((issue) => {
      if (!NON_CLOSED_STATUSES.includes(issue.status as (typeof NON_CLOSED_STATUSES)[number]))
        return false;
      const updatedAt = Date.parse(issue.updated_at);
      if (!Number.isFinite(updatedAt)) throw new Error('TD returned an invalid issue update time');
      return updatedAt < cutoff;
    }).length
  };
}

function parseStats(value: unknown): Omit<IssueMetrics, 'staleCount'> {
  if (!value || typeof value !== 'object') throw new Error('TD HTTP returned invalid stats');
  const envelope = value as Record<string, unknown>;
  if (envelope.ok !== true || !envelope.data || typeof envelope.data !== 'object')
    throw new Error('TD HTTP returned invalid stats');
  const status = (envelope.data as Record<string, unknown>).by_status;
  if (!status || typeof status !== 'object') throw new Error('TD HTTP returned invalid stats');
  const counts = status as Record<string, unknown>;
  const openCount = nonNegativeInteger(counts.open ?? 0, 'open count');
  const inProgressCount = nonNegativeInteger(counts.in_progress ?? 0, 'in-progress count');
  const blockedCount = nonNegativeInteger(counts.blocked ?? 0, 'blocked count');
  const reviewCount = nonNegativeInteger(counts.in_review ?? 0, 'in-review count');
  return {
    openCount,
    inProgressCount,
    blockedCount,
    reviewCount,
    totalNonClosedCount: openCount + inProgressCount + blockedCount + reviewCount
  };
}

function parseHttpIssueCount(value: unknown): number {
  if (!value || typeof value !== 'object') throw new Error('TD HTTP returned invalid issues');
  const envelope = value as Record<string, unknown>;
  if (envelope.ok !== true || !envelope.data || typeof envelope.data !== 'object')
    throw new Error('TD HTTP returned invalid issues');
  return nonNegativeInteger((envelope.data as Record<string, unknown>).total, 'stale count');
}

async function withTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error('TD collection aborted'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('TD HTTP timed out')), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}

async function fetchJson(http: HttpClient, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await http(url, { signal });
  if (!response.ok) throw new Error(`TD HTTP returned ${response.status}`);
  return parseDocument(await response.text(), 'TD HTTP');
}

async function collectHttp(
  port: number,
  http: HttpClient,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<IssueMetrics> {
  const base = `http://127.0.0.1:${port}`;
  return withTimeout(
    async (requestSignal) => {
      const health = await fetchJson(http, `${base}/health`, requestSignal);
      if (!health || typeof health !== 'object' || (health as Record<string, unknown>).ok !== true)
        throw new Error('TD HTTP health check failed');
      const staleQuery = new URLSearchParams({
        search: 'status != closed AND updated < -30d',
        search_mode: 'tdq',
        limit: '1'
      });
      const [stats, stale] = await Promise.all([
        fetchJson(http, `${base}/v1/stats`, requestSignal),
        fetchJson(http, `${base}/v1/issues?${staleQuery}`, requestSignal)
      ]);
      return { ...parseStats(stats), staleCount: parseHttpIssueCount(stale) };
    },
    timeoutMs,
    signal
  );
}

async function readServePort(projectPath: string): Promise<number | null> {
  try {
    const raw = (await readFile(join(projectPath, '.todos', 'serve-port'), 'utf8')).trim();
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function hasTdDatabase(projectPath: string): Promise<boolean> {
  try {
    await access(join(projectPath, '.todos', 'issues.db'));
    return true;
  } catch {
    return false;
  }
}

async function collectCli(
  projectPath: string,
  runner: CommandRunner,
  timeoutMs: number,
  now: Date,
  signal?: AbortSignal
): Promise<IssueMetrics> {
  // One unbounded, non-closed list keeps subprocess overhead low while ensuring
  // repositories above TD's default 50-item limit are counted completely.
  const command = ['td', '--work-dir', projectPath, '--json', 'list', '--all', '--limit', '0'];
  const result = await runner(command, {
    cwd: projectPath,
    timeoutMs,
    maxBufferBytes: 32 * 1024 * 1024,
    signal
  });
  if (result.aborted) throw signal?.reason ?? new Error('TD CLI aborted');
  if (result.timedOut) throw new Error('TD CLI timed out');
  if (result.exitCode !== 0)
    throw new Error(`TD CLI failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`);
  return metricsFromIssues(parseIssues(parseDocument(result.stdout, 'TD CLI'), 'TD CLI'), now);
}

export async function collectTdMetrics(
  projectPath: string,
  options: TdCollectionOptions = {}
): Promise<IssueMetrics | null> {
  if (!(await hasTdDatabase(projectPath))) return null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('TD timeout must be positive');
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.valueOf())) throw new Error('TD collector clock returned an invalid time');
  const runner = options.runner ?? runCommand;
  const http = options.http ?? ((url, init) => fetch(url, init));
  const port = await readServePort(projectPath);
  if (port !== null) {
    try {
      return await collectHttp(port, http, timeoutMs, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
      // A stale port file is routine after `td serve` exits. Fall through to
      // the supported CLI rather than surfacing it as a project failure.
    }
  }
  return collectCli(projectPath, runner, timeoutMs, now, options.signal);
}

export class TdIssueMetricsProvider implements IssueMetricsProvider {
  constructor(private readonly options: TdCollectionOptions = {}) {}

  collect(projectPath: string, signal?: AbortSignal): Promise<IssueMetrics | null> {
    return collectTdMetrics(projectPath, { ...this.options, signal });
  }
}
