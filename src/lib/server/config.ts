import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  scanRoots: string[];
  databasePath: string;
  maxScanDepth: number;
  ignoreGlobs: string[];
  gitConcurrency: number;
  clocConcurrency: number;
}

const defaultIgnoreGlobs = [
  '**/node_modules/**',
  '**/.cache/**',
  '**/build/**',
  '**/dist/**',
  '**/.data/**'
];

function expandPath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const scanRoots = (env.SCAN_ROOTS ?? '~/code')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean)
    .map(expandPath);
  if (scanRoots.length === 0) throw new Error('SCAN_ROOTS must contain at least one path');

  return {
    host: env.HOST || '127.0.0.1',
    port: positiveInteger(env.PORT, 4173, 'PORT'),
    scanRoots,
    databasePath: expandPath(env.DATABASE_PATH || '.data/ongoing.sqlite'),
    maxScanDepth: positiveInteger(env.MAX_SCAN_DEPTH, 3, 'MAX_SCAN_DEPTH'),
    ignoreGlobs: env.IGNORE_GLOBS
      ? env.IGNORE_GLOBS.split(',')
          .map((glob) => glob.trim())
          .filter(Boolean)
      : defaultIgnoreGlobs,
    gitConcurrency: positiveInteger(env.GIT_CONCURRENCY, 6, 'GIT_CONCURRENCY'),
    clocConcurrency: positiveInteger(env.CLOC_CONCURRENCY, 2, 'CLOC_CONCURRENCY')
  };
}
