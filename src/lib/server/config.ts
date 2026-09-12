import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { providerNames } from '$lib/domain/provider';
import {
  configPathFrom,
  providerSettings,
  readConfigFile,
  type FileConfig,
  type ProviderSettings
} from './config-file';

export interface ProvidersConfig {
  /** Every shipped provider, minus what configuration turned off. */
  enabled: string[];
  /** Per-provider settings from `[providers.<name>]`, for the adapters that read them. */
  settings: Record<string, ProviderSettings>;
}

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
  forgetMissingAfterDays: number;
  releaseBaselineEnabled: boolean;
  releaseBaselineMaxAgeHours: number;
  releaseBaselineApiUrl: string;
  /** Which providers may run, and what each of them was configured with (ADR 0007). */
  providers: ProvidersConfig;
  /** The host adapter behind `serve`, `scan`, `restart`, `stop`, and `logs`. */
  hostAdapter: string;
  /** The configuration file this configuration was read from, when there was one. */
  configPath: string | null;
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

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${name} must be a non-negative integer`);
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

function stringList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Which providers may run. Every shipped provider is on unless configuration turns it off, so an
 * install that has never written a configuration file behaves exactly as it did before manifests
 * existed. `[providers] enabled = [...]` narrows the list; `disabled` subtracts from it;
 * `ONGOING_PROVIDERS` and `ONGOING_DISABLE_PROVIDERS` override both, and the older
 * `ONGOING_ENABLE_RELEASE_BASELINE=false` keeps working as a way to turn `endoflife` off.
 */
export function resolveEnabledProviders(
  env: Record<string, string | undefined>,
  file: FileConfig
): string[] {
  const configured = stringList(env.ONGOING_PROVIDERS) ?? file.providers?.enabled;
  const enabled = new Set(
    configured?.length ? configured.filter((name) => providerNames.includes(name)) : providerNames
  );
  for (const name of stringList(env.ONGOING_DISABLE_PROVIDERS) ?? file.providers?.disabled ?? [])
    enabled.delete(name);
  if (env.ONGOING_ENABLE_RELEASE_BASELINE === 'false') enabled.delete('endoflife');
  return providerNames.filter((name) => enabled.has(name));
}

function providerText(
  settings: ProviderSettings,
  key: string,
  fallback: string | undefined
): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function providerNumber(settings: ProviderSettings, key: string): number | undefined {
  const value = settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Configuration, read from the environment over the configuration file over the defaults. The file
 * is passed in rather than read here so the function stays pure and a test can hand it a document
 * without touching the machine's real `~/.config/ongoing/config.toml`; {@link loadRuntimeConfig}
 * is the one that reads from disk.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  file: FileConfig = {},
  configPath: string | null = null
): AppConfig {
  const filesystem = providerSettings(file, 'filesystem');
  const endoflife = providerSettings(file, 'endoflife');
  if (
    env.ONGOING_ENABLE_RELEASE_BASELINE &&
    !['true', 'false'].includes(env.ONGOING_ENABLE_RELEASE_BASELINE)
  )
    throw new Error('ONGOING_ENABLE_RELEASE_BASELINE must be true or false');
  const enabledProviders = resolveEnabledProviders(env, file);
  const host = (env.HOST || file.server?.host || '127.0.0.1').trim();
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
  // `[providers.filesystem] roots` is the discovery adapter's own setting; SCAN_ROOTS and the older
  // `[scan] roots` stay as the override and the shorthand.
  const configuredRoots =
    stringList(env.SCAN_ROOTS) ??
    (Array.isArray(filesystem.roots) ? filesystem.roots : undefined) ??
    file.scan?.roots ??
    stringList('~/code')!;
  const scanRoots = configuredRoots.map(expandPath);
  if (scanRoots.length === 0) throw new Error('SCAN_ROOTS must contain at least one path');

  return {
    host,
    port: positiveInteger(env.PORT, file.server?.port ?? 4173, 'PORT'),
    scanRoots,
    databasePath: expandPath(env.DATABASE_PATH || file.server?.database || '.data/ongoing.sqlite'),
    maxScanDepth: positiveInteger(
      env.MAX_SCAN_DEPTH,
      providerNumber(filesystem, 'max_depth') ?? file.scan?.max_depth ?? 3,
      'MAX_SCAN_DEPTH'
    ),
    ignoreGlobs:
      stringList(env.IGNORE_GLOBS) ??
      (Array.isArray(filesystem.ignore) ? filesystem.ignore : undefined) ??
      file.scan?.ignore ??
      defaultIgnoreGlobs,
    gitConcurrency: positiveInteger(
      env.GIT_CONCURRENCY,
      file.scan?.git_concurrency ?? 6,
      'GIT_CONCURRENCY'
    ),
    clocConcurrency: positiveInteger(
      env.CLOC_CONCURRENCY,
      file.scan?.cloc_concurrency ?? 2,
      'CLOC_CONCURRENCY'
    ),
    automaticScanSchedulerEnabled: boolean(
      env.ONGOING_ENABLE_SCAN_SCHEDULER,
      file.scan?.scheduler ?? true,
      'ONGOING_ENABLE_SCAN_SCHEDULER'
    ),
    // The catalog tracks ongoing work, not history: a project whose directory is gone is dropped
    // rather than archived. Set false to keep missing rows and prune them by hand instead.
    forgetMissingProjects: boolean(
      env.ONGOING_FORGET_MISSING,
      (filesystem.forget_missing as boolean | undefined) ?? file.scan?.forget_missing ?? true,
      'ONGOING_FORGET_MISSING'
    ),
    // A directory can be absent without being deleted — a rename, a move, an unmounted volume all
    // look identical to a stat. Wait this long before believing it, so one bad look cannot destroy
    // a project's note and decisions. 0 forgets on the first scan that finds it gone.
    forgetMissingAfterDays: nonNegativeInteger(
      env.ONGOING_FORGET_MISSING_AFTER_DAYS,
      providerNumber(filesystem, 'forget_missing_after_days') ??
        file.scan?.forget_missing_after_days ??
        7,
      'ONGOING_FORGET_MISSING_AFTER_DAYS'
    ),
    releaseBaselineEnabled: enabledProviders.includes('endoflife'),
    releaseBaselineMaxAgeHours: positiveInteger(
      env.RELEASE_BASELINE_MAX_AGE_HOURS,
      providerNumber(endoflife, 'max_age_hours') ?? 24,
      'RELEASE_BASELINE_MAX_AGE_HOURS'
    ),
    releaseBaselineApiUrl: (
      env.RELEASE_BASELINE_API_URL ||
      providerText(endoflife, 'api_url', undefined) ||
      DEFAULT_RELEASE_BASELINE_API_URL
    ).replace(/\/+$/, ''),
    providers: {
      enabled: enabledProviders,
      settings: Object.fromEntries(
        providerNames.map((name) => [name, providerSettings(file, name)])
      )
    },
    hostAdapter: (env.ONGOING_HOST_ADAPTER || file.host?.adapter || 'launchd').trim(),
    configPath,
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

/**
 * Configuration as a running process sees it: the file on disk, overridden by the environment.
 * Every entry point — the web service, the scan agent, and the CLI's in-process transport — goes
 * through this, so they cannot disagree about which providers are on.
 */
export function loadRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const file = readConfigFile(configPathFrom(env));
  return loadConfig(env, file.config, file.present ? file.path : null);
}
