import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTdMetrics, TdIssueMetricsProvider, type HttpClient } from './td';
import type { CommandRunner } from './process';

const directories: string[] = [];
const now = new Date('2026-07-19T10:00:00.000Z');

async function project(withDatabase = true, servePort?: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'ongoing-td-'));
  directories.push(path);
  if (withDatabase || servePort !== undefined) await mkdir(join(path, '.todos'));
  if (withDatabase) await writeFile(join(path, '.todos', 'issues.db'), 'fixture');
  if (servePort !== undefined) await writeFile(join(path, '.todos', 'serve-port'), servePort);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

function cliRunner(issues: unknown): CommandRunner {
  return vi.fn(async (command, options) => ({
    command,
    cwd: options.cwd,
    exitCode: 0,
    stdout: JSON.stringify(issues),
    stderr: '',
    timedOut: false
  }));
}

describe('TD issue metrics provider', () => {
  it('returns unavailable without invoking clients when the TD database is absent', async () => {
    const path = await project(false);
    const runner = vi.fn<CommandRunner>();
    const http = vi.fn<HttpClient>();
    await expect(new TdIssueMetricsProvider({ runner, http }).collect(path)).resolves.toBeNull();
    expect(runner).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it('prefers a healthy HTTP server and combines stats with a stale issue count', async () => {
    const path = await project(true, '43210\n');
    const runner = vi.fn<CommandRunner>();
    const http = vi.fn<HttpClient>(async (url) => {
      if (url.endsWith('/health')) return response({ ok: true, data: { status: 'ok' } });
      if (url.endsWith('/v1/stats'))
        return response({
          ok: true,
          data: {
            by_status: { open: 70, in_progress: 8, blocked: 3, in_review: 4, closed: 100 }
          }
        });
      expect(url).toContain('/v1/issues?');
      expect(url).toContain('limit=1');
      return response({ ok: true, data: { issues: [], total: 13, limit: 1, offset: 0 } });
    });

    await expect(collectTdMetrics(path, { runner, http, now: () => now })).resolves.toEqual({
      openCount: 70,
      inProgressCount: 8,
      blockedCount: 3,
      reviewCount: 4,
      totalNonClosedCount: 85,
      staleCount: 13
    });
    expect(runner).not.toHaveBeenCalled();
    expect(http).toHaveBeenCalledTimes(3);
  });

  it('falls back from an unhealthy HTTP server to a literal, unlimited CLI query', async () => {
    const path = await project(true, '43210');
    const issues = [
      { status: 'open', updated_at: '2026-05-01T00:00:00Z' },
      { status: 'in_progress', updated_at: '2026-07-10T00:00:00Z' },
      { status: 'blocked', updated_at: '2026-04-01T00:00:00Z' },
      { status: 'in_review', updated_at: '2026-07-18T00:00:00Z' }
    ];
    const runner = cliRunner(issues);
    const http: HttpClient = async () => response({ ok: false }, 503);

    await expect(collectTdMetrics(path, { runner, http, now: () => now })).resolves.toEqual({
      openCount: 1,
      inProgressCount: 1,
      blockedCount: 1,
      reviewCount: 1,
      totalNonClosedCount: 4,
      staleCount: 2
    });
    expect(runner).toHaveBeenCalledWith(
      ['td', '--work-dir', path, '--json', 'list', '--all', '--limit', '0'],
      expect.objectContaining({ cwd: path, timeoutMs: 5_000 })
    );
  });

  it('counts repositories larger than TD default limits', async () => {
    const path = await project();
    const issues = Array.from({ length: 137 }, (_, index) => ({
      status: index < 100 ? 'open' : 'in_progress',
      updated_at: index % 2 ? '2026-07-18T00:00:00Z' : '2026-01-01T00:00:00Z'
    }));
    await expect(
      collectTdMetrics(path, { runner: cliRunner(issues), now: () => now })
    ).resolves.toMatchObject({ openCount: 100, inProgressCount: 37, totalNonClosedCount: 137 });
  });

  it.each([
    ['timeout', { exitCode: null, stdout: '', stderr: '', timedOut: true }, 'timed out'],
    [
      'malformed output',
      { exitCode: 0, stdout: '{', stderr: '', timedOut: false },
      'malformed JSON'
    ],
    [
      'missing CLI',
      { exitCode: 127, stdout: '', stderr: 'td: not found', timedOut: false },
      'not found'
    ]
  ])('isolates CLI %s failures', async (_label, fixture, message) => {
    const path = await project();
    const runner: CommandRunner = async (command, options) => ({
      command,
      cwd: options.cwd,
      ...fixture
    });
    await expect(collectTdMetrics(path, { runner, now: () => now })).rejects.toThrow(message);
  });

  it('uses an explicit HTTP timeout before falling back to CLI', async () => {
    const path = await project(true, '43210');
    const http: HttpClient = async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    await expect(
      collectTdMetrics(path, { http, runner: cliRunner([]), timeoutMs: 10, now: () => now })
    ).resolves.toMatchObject({ totalNonClosedCount: 0 });
  });
});
