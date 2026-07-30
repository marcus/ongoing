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
  automaticScanSchedulerEnabled: boolean;
  forgetMissingProjects: boolean;
  releaseBaselineEnabled: boolean;
  releaseBaselineMaxAgeHours: number;
  releaseBaselineApiUrl: string;
  security: SecurityConfig;
}

export interface SecurityConfig {
  authenticationRequired: boolean;
  accessSecret?: string;
  sessionMaxAgeSeconds: number;
  cookieSecure: boolean;
  appOrigin?: string;
  maxRequestBytes: number;
}

export const DEFAULT_RELEASE_BASELINE_API_URL = 'https://endoflife.date/api/v1';

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

function boolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  return Boolean(
    match &&
    Number(match[1]) === 127 &&
    match.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255)
  );
}

function optionalOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('APP_ORIGIN must be an absolute http(s) origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error('APP_ORIGIN must be an absolute http(s) origin without a path');
  return url.origin;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const host = (env.HOST || '127.0.0.1').trim();
  if (!host) throw new Error('HOST must not be empty');
  if (env.ONGOING_REQUIRE_AUTH && !['true', 'false'].includes(env.ONGOING_REQUIRE_AUTH))
    throw new Error('ONGOING_REQUIRE_AUTH must be true or false');
  // Escape hatch for local-network deployments where no login is wanted.
  // Set ONGOING_DISABLE_AUTH=true to bypass the access-secret login entirely.
  // Default (unset/false) preserves the original secret-based auth. See docs/auth.md.
  const authDisabled = env.ONGOING_DISABLE_AUTH === 'true';
  const authenticationRequired =
    !authDisabled && (!isLoopbackHost(host) || env.ONGOING_REQUIRE_AUTH === 'true');
  const accessSecret = env.ONGOING_ACCESS_SECRET;
  if (authenticationRequired && !accessSecret)
    throw new Error('ONGOING_ACCESS_SECRET is required for a non-loopback HOST');
  if (accessSecret && accessSecret.length < 16)
    throw new Error('ONGOING_ACCESS_SECRET must contain at least 16 characters');
  const appOrigin = optionalOrigin(env.APP_ORIGIN);
  const cookieSecure = env.SESSION_COOKIE_SECURE
    ? env.SESSION_COOKIE_SECURE === 'true'
    : appOrigin?.startsWith('https://') === true;
  if (env.SESSION_COOKIE_SECURE && !['true', 'false'].includes(env.SESSION_COOKIE_SECURE))
    throw new Error('SESSION_COOKIE_SECURE must be true or false');
  const scanRoots = (env.SCAN_ROOTS ?? '~/code')
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean)
    .map(expandPath);
  if (scanRoots.length === 0) throw new Error('SCAN_ROOTS must contain at least one path');

  return {
    host,
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
    clocConcurrency: positiveInteger(env.CLOC_CONCURRENCY, 2, 'CLOC_CONCURRENCY'),
    automaticScanSchedulerEnabled: boolean(
      env.ONGOING_ENABLE_SCAN_SCHEDULER,
      true,
      'ONGOING_ENABLE_SCAN_SCHEDULER'
    ),
    // The catalog tracks ongoing work, not history: a project whose directory is gone is dropped
    // rather than archived. Set false to keep missing rows and prune them by hand instead.
    forgetMissingProjects: boolean(env.ONGOING_FORGET_MISSING, true, 'ONGOING_FORGET_MISSING'),
    releaseBaselineEnabled: boolean(
      env.ONGOING_ENABLE_RELEASE_BASELINE,
      true,
      'ONGOING_ENABLE_RELEASE_BASELINE'
    ),
    releaseBaselineMaxAgeHours: positiveInteger(
      env.RELEASE_BASELINE_MAX_AGE_HOURS,
      24,
      'RELEASE_BASELINE_MAX_AGE_HOURS'
    ),
    releaseBaselineApiUrl: (
      env.RELEASE_BASELINE_API_URL || DEFAULT_RELEASE_BASELINE_API_URL
    ).replace(/\/+$/, ''),
    security: {
      authenticationRequired,
      accessSecret,
      sessionMaxAgeSeconds: positiveInteger(
        env.SESSION_MAX_AGE_SECONDS,
        43_200,
        'SESSION_MAX_AGE_SECONDS'
      ),
      cookieSecure,
      appOrigin,
      maxRequestBytes: positiveInteger(env.MAX_REQUEST_BYTES, 16_384, 'MAX_REQUEST_BYTES')
    }
  };
}
