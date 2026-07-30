import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRunner } from './process';
import { runCommand, runSuccessfulCommand } from './process';
import { collectGitMetrics, collectTrackedWorktreeFingerprint, createScanFingerprint } from './git';

const temporaryDirectories: string[] = [];

async function makeRepository(name: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'ongoing-git-'));
  temporaryDirectories.push(parent);
  const repository = join(parent, name);
  await mkdir(repository);
  await runSuccessfulCommand(['git', 'init', '-b', 'main'], { cwd: repository, timeoutMs: 2_000 });
  await runSuccessfulCommand(['git', 'config', 'user.name', 'Local Author'], {
    cwd: repository,
    timeoutMs: 2_000
  });
  await runSuccessfulCommand(['git', 'config', 'user.email', 'local@example.com'], {
    cwd: repository,
    timeoutMs: 2_000
  });
  return repository;
}

async function commit(
  repository: string,
  file: string,
  contents: string,
  message: string
): Promise<void> {
  await writeFile(join(repository, file), contents);
  await runSuccessfulCommand(['git', 'add', file], { cwd: repository, timeoutMs: 2_000 });
  await runSuccessfulCommand(['git', 'commit', '-m', message], {
    cwd: repository,
    timeoutMs: 2_000
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Git metrics', () => {
  it('collects all planned local metrics for tagged and dirty repositories', async () => {
    const repository = await makeRepository('metrics café with spaces');
    await commit(repository, 'one.txt', 'one\n', 'first commit');
    await runSuccessfulCommand(['git', 'tag', 'v1.0.0'], { cwd: repository, timeoutMs: 2_000 });
    await commit(repository, 'two.txt', 'two\nthree\n', 'second commit');
    await writeFile(join(repository, 'two.txt'), 'changed\n');

    const metrics = await collectGitMetrics(repository, { now: () => '2026-07-19T12:00:00.000Z' });
    expect(metrics).toMatchObject({
      branch: 'main',
      latestCommitSubject: 'second commit',
      commitCount: 2,
      commits7d: 2,
      commits30d: 2,
      commits90d: 2,
      activeDays30d: 1,
      activeDays90d: 1,
      churnAdded30d: 3,
      churnDeleted30d: 0,
      contributorCount: 1,
      localAuthorCommitShare30d: 1,
      dirtyFiles: 1,
      aheadCount: null,
      behindCount: null,
      latestTag: 'v1.0.0',
      commitsSinceLatestTag: 1,
      gitScannedAt: '2026-07-19T12:00:00.000Z'
    });
    expect(metrics.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(metrics.latestCommitShortSha).toMatch(/^[0-9a-f]+$/);
    expect(metrics.latestCommitAt).not.toBeNull();
  });

  it('reports upstream ahead and behind counts', async () => {
    const repository = await makeRepository('upstream');
    await commit(repository, 'one.txt', 'one\n', 'first');
    await runSuccessfulCommand(['git', 'branch', 'upstream'], {
      cwd: repository,
      timeoutMs: 2_000
    });
    await runSuccessfulCommand(['git', 'branch', '--set-upstream-to=upstream', 'main'], {
      cwd: repository,
      timeoutMs: 2_000
    });
    await commit(repository, 'two.txt', 'two\n', 'ahead');
    expect(await collectGitMetrics(repository)).toMatchObject({ aheadCount: 1, behindCount: 0 });
  });

  it('returns useful partial metrics for an empty repository without identity, upstream, or tags', async () => {
    const repository = await makeRepository('empty');
    await runSuccessfulCommand(['git', 'config', '--unset', 'user.email'], {
      cwd: repository,
      timeoutMs: 2_000
    });
    const metrics = await collectGitMetrics(repository);
    expect(metrics).toMatchObject({
      headSha: null,
      branch: null,
      commitCount: 0,
      commits30d: 0,
      activeDays90d: 0,
      contributorCount: 0,
      localAuthorCommitShare30d: null,
      dirtyFiles: 0,
      aheadCount: null,
      latestTag: null
    });
  });

  it('leaves local author share null when a committed repository has no identity', async () => {
    const repository = await makeRepository('missing identity');
    await commit(repository, 'one.txt', 'one\n', 'commit before identity removal');
    await runSuccessfulCommand(['git', 'config', '--unset', 'user.email'], {
      cwd: repository,
      timeoutMs: 2_000
    });
    await runSuccessfulCommand(['git', 'config', '--unset', 'user.name'], {
      cwd: repository,
      timeoutMs: 2_000
    });
    const noIdentityRunner: CommandRunner = (command, options) =>
      command[1] === 'config'
        ? Promise.resolve({
            command,
            cwd: options.cwd,
            exitCode: 1,
            stdout: '',
            stderr: '',
            timedOut: false
          })
        : runCommand(command, options);
    expect(await collectGitMetrics(repository, { runner: noIdentityRunner })).toMatchObject({
      commitCount: 1,
      contributorCount: 1,
      localAuthorCommitShare30d: null
    });
  });

  it('turns timed out and malformed command output into partial null metrics', async () => {
    const malformedRunner: CommandRunner = async (command, options) => ({
      command,
      cwd: options.cwd,
      exitCode: 0,
      stdout: command.includes('status') ? '?? malformed\n' : 'not-a-sha\n',
      stderr: '',
      timedOut: command.includes('status')
    });
    const metrics = await collectGitMetrics('/safe/path', { runner: malformedRunner });
    expect(metrics).toMatchObject({ headSha: null, commitCount: null, dirtyFiles: null });
  });
});

describe('scan fingerprints', () => {
  it('is deterministic, unambiguous, and changes with tracked content', async () => {
    expect(createScanFingerprint(['a', 'bc'])).not.toBe(createScanFingerprint(['ab', 'c']));
    expect(createScanFingerprint(['a', 'bc'])).toBe(createScanFingerprint(['a', 'bc']));
    const repository = await makeRepository('fingerprint');
    await commit(repository, 'tracked.txt', 'one\n', 'first');
    const clean = await collectTrackedWorktreeFingerprint(repository);
    await writeFile(join(repository, 'untracked.txt'), 'ignored\n');
    expect(await collectTrackedWorktreeFingerprint(repository)).toBe(clean);
    await writeFile(join(repository, 'tracked.txt'), 'two\n');
    expect(await collectTrackedWorktreeFingerprint(repository)).not.toBe(clean);
  });

  it('fingerprints a repository whose first commit does not exist yet', async () => {
    const repository = await makeRepository('unborn');
    const empty = await collectTrackedWorktreeFingerprint(repository);
    expect(empty).toBeTypeOf('string');
    await writeFile(join(repository, 'untracked.txt'), 'ignored\n');
    expect(await collectTrackedWorktreeFingerprint(repository)).toBe(empty);
    await commit(repository, 'tracked.txt', 'one\n', 'first');
    expect(await collectTrackedWorktreeFingerprint(repository)).not.toBe(empty);
  });

  it('reports no fingerprint outside a repository', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ongoing-git-'));
    temporaryDirectories.push(parent);
    expect(await collectTrackedWorktreeFingerprint(parent)).toBeNull();
  });
});
