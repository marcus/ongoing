import { collectTrackedWorktreeFingerprint } from './git';
import { runCommand, type CommandRunner } from './process';

export interface LocMetrics {
  locCode: number;
  locComment: number;
  locBlank: number;
  locFiles: number;
  locTest: number;
  dominantLanguage: string | null;
  locFingerprint: string | null;
  locScannedAt: string;
}

export interface LocCollectionOptions {
  previousFingerprint?: string | null;
  force?: boolean;
  timeoutMs?: number;
  runner?: CommandRunner;
  now?: () => string;
  fingerprint?: (repositoryPath: string) => Promise<string | null>;
  signal?: AbortSignal;
}

export type LocCollectionResult =
  { status: 'unchanged'; fingerprint: string } | { status: 'collected'; metrics: LocMetrics };

interface ClocFile {
  language?: unknown;
  blank?: unknown;
  comment?: unknown;
  code?: unknown;
}

const TEST_PATH =
  /(^|[/\\])(?:__tests__|tests?|specs?)([/\\]|$)|(?:^|[/\\])[^/\\]+\.(?:test|spec)\.[^/\\]+$/i;

function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid cloc ${label}`);
  return value;
}

export function parseClocJson(output: string): Omit<LocMetrics, 'locFingerprint' | 'locScannedAt'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('cloc returned malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('cloc returned an invalid document');

  const document = parsed as Record<string, unknown>;
  const files = Object.entries(document).filter(
    ([name, value]) =>
      name !== 'header' &&
      name !== 'SUM' &&
      value !== null &&
      typeof value === 'object' &&
      'language' in value
  ) as [string, ClocFile][];
  const byLanguage = new Map<string, number>();
  let locCode = 0;
  let locComment = 0;
  let locBlank = 0;
  let locTest = 0;

  for (const [path, file] of files) {
    if (typeof file.language !== 'string' || !file.language)
      throw new Error('cloc returned a file without a language');
    const code = count(file.code, 'code count');
    locCode += code;
    locComment += count(file.comment, 'comment count');
    locBlank += count(file.blank, 'blank count');
    if (TEST_PATH.test(path)) locTest += code;
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + code);
  }

  // Empty repositories are valid and cloc may only emit SUM.
  if (files.length === 0 && document.SUM && typeof document.SUM === 'object') {
    const sum = document.SUM as ClocFile;
    locCode = count(sum.code, 'code count');
    locComment = count(sum.comment, 'comment count');
    locBlank = count(sum.blank, 'blank count');
  }

  const dominantLanguage =
    [...byLanguage.entries()].sort(
      ([leftLanguage, leftCode], [rightLanguage, rightCode]) =>
        rightCode - leftCode || leftLanguage.localeCompare(rightLanguage)
    )[0]?.[0] ?? null;

  return {
    locCode,
    locComment,
    locBlank,
    locFiles: files.length,
    locTest,
    dominantLanguage
  };
}

export async function collectLocMetrics(
  repositoryPath: string,
  options: LocCollectionOptions = {}
): Promise<LocCollectionResult> {
  const runner = options.runner ?? runCommand;
  const fingerprint = await (options.fingerprint
    ? options.fingerprint(repositoryPath)
    : collectTrackedWorktreeFingerprint(repositoryPath, {
        runner,
        timeoutMs: options.timeoutMs,
        signal: options.signal
      }));
  // The fingerprint is only a cache key. A repository that cannot produce one still gets counted;
  // it just re-runs cloc every scan instead of failing the collector.
  if (fingerprint !== null && !options.force && fingerprint === options.previousFingerprint)
    return { status: 'unchanged', fingerprint };

  const result = await runner(['cloc', '--json', '--by-file', '--vcs', 'git'], {
    cwd: repositoryPath,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxBufferBytes: 32 * 1024 * 1024,
    signal: options.signal
  });
  if (result.aborted) throw options.signal?.reason ?? new Error('cloc aborted');
  if (result.timedOut) throw new Error('cloc timed out');
  if (result.exitCode !== 0)
    throw new Error(
      `cloc failed: ${result.stderr.trim() || `exit code ${String(result.exitCode)}`}`
    );

  return {
    status: 'collected',
    metrics: {
      ...parseClocJson(result.stdout),
      locFingerprint: fingerprint,
      locScannedAt: (options.now ?? (() => new Date().toISOString()))()
    }
  };
}
