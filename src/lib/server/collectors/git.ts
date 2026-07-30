import { createHash } from 'node:crypto';
import type { ProjectMetrics } from '$lib/domain/metrics';
import { runCommand, type CommandResult, type CommandRunner } from './process';

export type GitMetrics = Pick<
  ProjectMetrics,
  | 'headSha'
  | 'branch'
  | 'latestCommitAt'
  | 'latestCommitSubject'
  | 'latestCommitShortSha'
  | 'commitCount'
  | 'commits7d'
  | 'commits30d'
  | 'commits90d'
  | 'activeDays30d'
  | 'activeDays90d'
  | 'churnAdded30d'
  | 'churnDeleted30d'
  | 'churnAdded90d'
  | 'churnDeleted90d'
  | 'contributorCount'
  | 'localAuthorCommitShare30d'
  | 'dirtyFiles'
  | 'aheadCount'
  | 'behindCount'
  | 'latestTag'
  | 'commitsSinceLatestTag'
  | 'gitScannedAt'
>;

export interface GitCollectionOptions {
  timeoutMs?: number;
  runner?: CommandRunner;
  now?: () => string;
  signal?: AbortSignal;
}

function successful(result: CommandResult): string | null {
  return !result.timedOut && !result.aborted && result.exitCode === 0 ? result.stdout : null;
}

function strictInteger(output: string | null): number | null {
  if (output === null || !/^\s*\d+\s*$/.test(output)) return null;
  const value = Number(output.trim());
  return Number.isSafeInteger(value) ? value : null;
}

function uniqueDays(output: string | null): number | null {
  if (output === null) return null;
  const days = output.split(/\r?\n/).filter(Boolean);
  if (days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) return null;
  return new Set(days).size;
}

function churn(output: string | null): { added: number; deleted: number } | null {
  if (output === null) return null;
  let added = 0;
  let deleted = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split('\t');
    if (columns.length < 3) return null;
    if (columns[0] === '-' && columns[1] === '-') continue;
    if (!/^\d+$/.test(columns[0]) || !/^\d+$/.test(columns[1])) return null;
    added += Number(columns[0]);
    deleted += Number(columns[1]);
  }
  return { added, deleted };
}

function latestCommit(
  output: string | null
): Pick<GitMetrics, 'latestCommitAt' | 'latestCommitSubject' | 'latestCommitShortSha'> {
  const empty = { latestCommitAt: null, latestCommitSubject: null, latestCommitShortSha: null };
  if (output === null) return empty;
  const fields = output.replace(/\r?\n$/, '').split('\0');
  if (fields.length !== 3 || !fields[0] || !fields[2]) return empty;
  const timestamp = new Date(fields[0]);
  if (Number.isNaN(timestamp.valueOf()) || !/^[0-9a-f]+$/i.test(fields[2])) return empty;
  return {
    latestCommitAt: timestamp.toISOString(),
    latestCommitSubject: fields[1],
    latestCommitShortSha: fields[2]
  };
}

async function git(
  runner: CommandRunner,
  repositoryPath: string,
  timeoutMs: number,
  args: readonly string[],
  signal?: AbortSignal,
  maxBufferBytes?: number
): Promise<CommandResult> {
  return runner(['git', ...args], { cwd: repositoryPath, timeoutMs, signal, maxBufferBytes });
}

export async function collectGitMetrics(
  repositoryPath: string,
  options: GitCollectionOptions = {}
): Promise<GitMetrics> {
  const runner = options.runner ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const run = (args: readonly string[]) =>
    git(runner, repositoryPath, timeoutMs, args, options.signal);
  const headResult = await run(['rev-parse', '--verify', 'HEAD']);
  const headOutput = successful(headResult);
  const headSha = headOutput && /^[0-9a-f]{40,64}\s*$/i.test(headOutput) ? headOutput.trim() : null;
  const dirtyOutput = successful(await run(['status', '--porcelain=v1', '--untracked-files=no']));
  const dirtyFiles =
    dirtyOutput === null ? null : dirtyOutput.split(/\r?\n/).filter(Boolean).length;
  const gitScannedAt = (options.now ?? (() => new Date().toISOString()))();

  if (!headSha) {
    const emptyRepository = !headResult.timedOut && headResult.exitCode !== 0;
    const emptyMetric = emptyRepository ? 0 : null;
    return {
      headSha: null,
      branch: null,
      latestCommitAt: null,
      latestCommitSubject: null,
      latestCommitShortSha: null,
      commitCount: emptyMetric,
      commits7d: emptyMetric,
      commits30d: emptyMetric,
      commits90d: emptyMetric,
      activeDays30d: emptyMetric,
      activeDays90d: emptyMetric,
      churnAdded30d: emptyMetric,
      churnDeleted30d: emptyMetric,
      churnAdded90d: emptyMetric,
      churnDeleted90d: emptyMetric,
      contributorCount: emptyMetric,
      localAuthorCommitShare30d: null,
      dirtyFiles,
      aheadCount: null,
      behindCount: null,
      latestTag: null,
      commitsSinceLatestTag: null,
      gitScannedAt
    };
  }

  const [
    branchResult,
    latestResult,
    countResult,
    count7Result,
    count30Result,
    count90Result,
    days30Result,
    days90Result,
    churn30Result,
    churn90Result,
    contributorsResult,
    identityEmailResult,
    identityNameResult,
    authorEmailsResult,
    authorNamesResult,
    upstreamResult,
    tagResult
  ] = await Promise.all([
    run(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    run(['log', '-1', '--format=%cI%x00%s%x00%h', 'HEAD']),
    run(['rev-list', '--count', 'HEAD']),
    run(['rev-list', '--count', '--since=7 days ago', 'HEAD']),
    run(['rev-list', '--count', '--since=30 days ago', 'HEAD']),
    run(['rev-list', '--count', '--since=90 days ago', 'HEAD']),
    run(['log', '--since=30 days ago', '--format=%cs', 'HEAD']),
    run(['log', '--since=90 days ago', '--format=%cs', 'HEAD']),
    run(['log', '--since=30 days ago', '--numstat', '--format=', 'HEAD']),
    run(['log', '--since=90 days ago', '--numstat', '--format=', 'HEAD']),
    run(['shortlog', '-sne', 'HEAD']),
    run(['config', '--get', 'user.email']),
    run(['config', '--get', 'user.name']),
    run(['log', '--since=30 days ago', '--format=%aE', 'HEAD']),
    run(['log', '--since=30 days ago', '--format=%aN', 'HEAD']),
    run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    run(['describe', '--tags', '--abbrev=0', 'HEAD'])
  ]);

  const branchOutput = successful(branchResult);
  const branch =
    branchOutput && branchOutput.trim() && !branchOutput.trim().includes('\n')
      ? branchOutput.trim()
      : null;
  const churn30 = churn(successful(churn30Result));
  const churn90 = churn(successful(churn90Result));
  const contributorsOutput = successful(contributorsResult);
  const contributorCount =
    contributorsOutput === null ? null : contributorsOutput.split(/\r?\n/).filter(Boolean).length;

  const identityEmail = successful(identityEmailResult)?.trim().toLocaleLowerCase() || null;
  const identityName = successful(identityNameResult)?.trim().toLocaleLowerCase() || null;
  const authorsOutput = identityEmail
    ? successful(authorEmailsResult)
    : identityName
      ? successful(authorNamesResult)
      : null;
  const authors = authorsOutput?.split(/\r?\n/).filter(Boolean) ?? [];
  const identity = identityEmail ?? identityName;
  const localAuthorCommitShare30d =
    identity && authorsOutput !== null && authors.length > 0
      ? authors.filter((author) => author.trim().toLocaleLowerCase() === identity).length /
        authors.length
      : null;

  const upstream = successful(upstreamResult)?.trim() || null;
  let aheadCount: number | null = null;
  let behindCount: number | null = null;
  if (upstream && !upstream.includes('\n')) {
    const counts = successful(
      await run(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
    );
    const match = counts?.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (match) {
      aheadCount = Number(match[1]);
      behindCount = Number(match[2]);
    }
  }

  const latestTagOutput = successful(tagResult)?.trim() || null;
  const latestTag = latestTagOutput && !latestTagOutput.includes('\n') ? latestTagOutput : null;
  const commitsSinceLatestTag = latestTag
    ? strictInteger(successful(await run(['rev-list', '--count', `${latestTag}..HEAD`])))
    : null;

  return {
    headSha,
    branch,
    ...latestCommit(successful(latestResult)),
    commitCount: strictInteger(successful(countResult)),
    commits7d: strictInteger(successful(count7Result)),
    commits30d: strictInteger(successful(count30Result)),
    commits90d: strictInteger(successful(count90Result)),
    activeDays30d: uniqueDays(successful(days30Result)),
    activeDays90d: uniqueDays(successful(days90Result)),
    churnAdded30d: churn30?.added ?? null,
    churnDeleted30d: churn30?.deleted ?? null,
    churnAdded90d: churn90?.added ?? null,
    churnDeleted90d: churn90?.deleted ?? null,
    contributorCount,
    localAuthorCommitShare30d,
    dirtyFiles,
    aheadCount,
    behindCount,
    latestTag,
    commitsSinceLatestTag,
    gitScannedAt
  };
}

export function createScanFingerprint(parts: readonly (string | null | undefined)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    const value = part ?? '';
    hash.update(String(Buffer.byteLength(value)));
    hash.update(':');
    hash.update(value);
    hash.update(';');
  }
  return hash.digest('hex');
}

/** Git's canonical empty tree, used as the diff base before the first commit exists. */
const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The diff is hashed rather than read, so a dirty worktree may far exceed the default buffer. */
const FINGERPRINT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** Fingerprint HEAD plus staged and unstaged changes to tracked files. */
export async function collectTrackedWorktreeFingerprint(
  repositoryPath: string,
  options: Pick<GitCollectionOptions, 'runner' | 'timeoutMs' | 'signal'> = {}
): Promise<string | null> {
  const runner = options.runner ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const diffAgainst = (base: string) =>
    git(
      runner,
      repositoryPath,
      timeoutMs,
      ['diff', '--binary', '--no-ext-diff', base, '--'],
      options.signal,
      FINGERPRINT_MAX_BUFFER_BYTES
    );
  const [head, diff] = await Promise.all([
    git(runner, repositoryPath, timeoutMs, ['rev-parse', '--verify', 'HEAD'], options.signal),
    diffAgainst('HEAD')
  ]);
  const headOutput = successful(head);
  if (headOutput !== null) {
    const diffOutput = successful(diff);
    return diffOutput === null ? null : createScanFingerprint([headOutput.trim(), diffOutput]);
  }
  // A branch whose first commit does not exist yet is still a valid repository, so fall back to
  // the empty tree rather than reporting an unfingerprintable repo.
  const initial = successful(await diffAgainst(EMPTY_TREE_OID));
  return initial === null ? null : createScanFingerprint([EMPTY_TREE_OID, initial]);
}
