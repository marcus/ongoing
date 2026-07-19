import { describe, expect, it, vi } from 'vitest';
import type { CommandRunner } from '$lib/server/collectors/process';
import { GitHubHttpClient, GitHubRequestError } from './client';

const missingGh: CommandRunner = async () => ({
  command: ['gh', 'auth', 'token'],
  cwd: '/code',
  stdout: '',
  stderr: 'secret should not escape',
  exitCode: 1,
  timedOut: false,
  aborted: false
});

describe('GitHubHttpClient diagnostics', () => {
  it('detects missing gh/environment authentication without making an API request', async () => {
    const fetcher = vi.fn(async () => new Response('{}'));
    const client = new GitHubHttpClient({ env: {}, runner: missingGh, fetch: fetcher });
    await expect(client.availability()).resolves.toBe('unauthenticated');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('detects invalid credentials without including tokens or response bodies in errors', async () => {
    const client = new GitHubHttpClient({
      env: { GH_TOKEN: 'top-secret-token' },
      fetch: async () => new Response('top-secret-response', { status: 401 })
    });
    await expect(client.availability()).resolves.toBe('unauthenticated');
    await expect(client.rest('/user')).rejects.toMatchObject({
      message: 'GitHub authentication is invalid',
      failure: 'unauthenticated'
    });
  });

  it('honors reset headers and defers subsequent requests from its cached limit', async () => {
    let calls = 0;
    const client = new GitHubHttpClient({
      env: { GITHUB_TOKEN: 'token' },
      now: () => new Date('2026-07-19T00:00:00Z'),
      fetch: async () => {
        calls += 1;
        return new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1784422800' }
        });
      }
    });
    const first = await client.rest('/repos/a/b').catch((error) => error as GitHubRequestError);
    expect(first).toMatchObject({ failure: 'rate_limited', resetAt: '2026-07-19T01:00:00.000Z' });
    const second = (await client.rest('/repos/a/b').catch((error) => error)) as GitHubRequestError;
    expect(second.failure).toBe('rate_limited');
    expect(calls).toBe(1);
  });
});
