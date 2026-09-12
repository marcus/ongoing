import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * The configuration file (ADR 0007, Decision 4).
 *
 * One TOML document at `~/.config/ongoing/config.toml`, `--config` or `ONGOING_CONFIG` to point
 * elsewhere. A list of enabled providers, each with its own settings, is not something environment
 * variables express without inventing a serialization inside a string — so the file owns the
 * provider list, and environment variables stay what they have always been: overrides and secrets.
 *
 * Precedence, highest first: environment variable, configuration file, built-in default.
 */
export const DEFAULT_CONFIG_PATH = '~/.config/ongoing/config.toml';

export interface ProviderSettings {
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface FileConfig {
  server?: {
    host?: string;
    port?: number;
    database?: string;
    origin?: string;
  };
  scan?: {
    roots?: string[];
    max_depth?: number;
    ignore?: string[];
    git_concurrency?: number;
    cloc_concurrency?: number;
    forget_missing?: boolean;
    forget_missing_after_days?: number;
    scheduler?: boolean;
  };
  providers?: {
    enabled?: string[];
    disabled?: string[];
    [provider: string]: ProviderSettings | string[] | undefined;
  };
  host?: { adapter?: string };
  export?: { profile?: string };
}

export function expandConfigPath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

/** The configuration file this process should read, honouring `ONGOING_CONFIG`. */
export function configPathFrom(env: Record<string, string | undefined> = process.env): string {
  return expandConfigPath(env.ONGOING_CONFIG?.trim() || DEFAULT_CONFIG_PATH);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error(`${where} must be an array of strings`);
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Parses the document and rejects anything the application does not understand, so a typo in a key
 * is an error at start-up rather than a setting that silently does nothing.
 */
export function parseConfigFile(text: string): FileConfig {
  let document: unknown;
  try {
    document = Bun.TOML.parse(text);
  } catch (error) {
    throw new Error(
      `Configuration is not valid TOML: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!isPlainObject(document)) throw new Error('Configuration must be a TOML table');

  const known = ['server', 'scan', 'providers', 'host', 'export'];
  const unknown = Object.keys(document).filter((key) => !known.includes(key));
  if (unknown.length)
    throw new Error(
      `Unknown configuration section(s): ${unknown.join(', ')} (expected ${known.join(', ')})`
    );

  const config: FileConfig = {};

  if (document.server !== undefined) {
    if (!isPlainObject(document.server)) throw new Error('[server] must be a table');
    const { host, port, database, origin, ...rest } = document.server;
    if (Object.keys(rest).length)
      throw new Error(`Unknown [server] key(s): ${Object.keys(rest).join(', ')}`);
    config.server = {
      ...(host === undefined ? {} : { host: String(host) }),
      ...(port === undefined ? {} : { port: Number(port) }),
      ...(database === undefined ? {} : { database: String(database) }),
      ...(origin === undefined ? {} : { origin: String(origin) })
    };
  }

  if (document.scan !== undefined) {
    if (!isPlainObject(document.scan)) throw new Error('[scan] must be a table');
    const scan = document.scan;
    const allowed = [
      'roots',
      'max_depth',
      'ignore',
      'git_concurrency',
      'cloc_concurrency',
      'forget_missing',
      'forget_missing_after_days',
      'scheduler'
    ];
    const extra = Object.keys(scan).filter((key) => !allowed.includes(key));
    if (extra.length) throw new Error(`Unknown [scan] key(s): ${extra.join(', ')}`);
    config.scan = {
      ...(scan.roots === undefined ? {} : { roots: stringArray(scan.roots, 'scan.roots') }),
      ...(scan.ignore === undefined ? {} : { ignore: stringArray(scan.ignore, 'scan.ignore') }),
      ...(scan.max_depth === undefined ? {} : { max_depth: Number(scan.max_depth) }),
      ...(scan.git_concurrency === undefined
        ? {}
        : { git_concurrency: Number(scan.git_concurrency) }),
      ...(scan.cloc_concurrency === undefined
        ? {}
        : { cloc_concurrency: Number(scan.cloc_concurrency) }),
      ...(scan.forget_missing === undefined
        ? {}
        : { forget_missing: Boolean(scan.forget_missing) }),
      ...(scan.forget_missing_after_days === undefined
        ? {}
        : { forget_missing_after_days: Number(scan.forget_missing_after_days) }),
      ...(scan.scheduler === undefined ? {} : { scheduler: Boolean(scan.scheduler) })
    };
  }

  if (document.providers !== undefined) {
    if (!isPlainObject(document.providers)) throw new Error('[providers] must be a table');
    const providers: FileConfig['providers'] = {};
    for (const [key, value] of Object.entries(document.providers)) {
      if (key === 'enabled' || key === 'disabled') {
        providers[key] = stringArray(value, `providers.${key}`);
        continue;
      }
      if (!isPlainObject(value))
        throw new Error(
          `[providers.${key}] must be a table of that provider's settings (only enabled and disabled are lists)`
        );
      providers[key] = value as ProviderSettings;
    }
    config.providers = providers;
  }

  if (document.host !== undefined) {
    if (!isPlainObject(document.host)) throw new Error('[host] must be a table');
    const { adapter, ...rest } = document.host;
    if (Object.keys(rest).length)
      throw new Error(`Unknown [host] key(s): ${Object.keys(rest).join(', ')}`);
    config.host = adapter === undefined ? {} : { adapter: String(adapter) };
  }

  if (document.export !== undefined) {
    if (!isPlainObject(document.export)) throw new Error('[export] must be a table');
    const { profile, ...rest } = document.export;
    if (Object.keys(rest).length)
      throw new Error(`Unknown [export] key(s): ${Object.keys(rest).join(', ')}`);
    config.export = profile === undefined ? {} : { profile: String(profile) };
  }

  return config;
}

export interface LoadedConfigFile {
  path: string;
  present: boolean;
  config: FileConfig;
}

/** Reads the configuration file if it exists. A missing file is not an error; defaults apply. */
export function readConfigFile(path: string): LoadedConfigFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path, present: false, config: {} };
    throw new Error(
      `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  try {
    return { path, present: true, config: parseConfigFile(text) };
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}

/** The settings written under `[providers.<name>]`, or an empty table. */
export function providerSettings(file: FileConfig, provider: string): ProviderSettings {
  const value = file.providers?.[provider];
  return Array.isArray(value) || value === undefined ? {} : value;
}
