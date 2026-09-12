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
  host?: { adapter?: string; label?: string };
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
    const { adapter, label, ...rest } = document.host;
    if (Object.keys(rest).length)
      throw new Error(`Unknown [host] key(s): ${Object.keys(rest).join(', ')}`);
    config.host = {
      ...(adapter === undefined ? {} : { adapter: String(adapter) }),
      ...(label === undefined ? {} : { label: String(label) })
    };
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

export interface ConfigTemplate {
  /** Where the catalog lives. `ongoing init` puts `ongoing.sqlite` inside it. */
  dataDir: string;
  /** Directories the filesystem provider looks in for Git repositories. */
  scanRoots: readonly string[];
  port: number;
  hostAdapter: string;
}

function tomlStrings(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

/**
 * The file `ongoing init` writes: every key a first install actually has an opinion about, with
 * the rest present as comments so the document itself is the reference. It is a pure function so a
 * test can read what `init` would write without writing anything.
 */
export function renderConfigFile(template: ConfigTemplate): string {
  return `# Ongoing configuration.
#
# Precedence, highest first: environment variable, this file, built-in default.
# A missing file is not an error — it means "all defaults". An unknown section or key is an
# error, so a typo fails at start-up rather than silently doing nothing.
# Reference: docs/cli.md

[server]
# The catalog. A directory nobody has written to becomes one on first open.
database = ${JSON.stringify(`${template.dataDir}/ongoing.sqlite`)}
port = ${template.port}
# host = "127.0.0.1"          # "0.0.0.0" needs ONGOING_ACCESS_SECRET, or auth turned off on purpose
# origin = "http://localhost:${template.port}"

[scan]
# Where to look for Git repositories.
roots = ${tomlStrings(template.scanRoots)}
# max_depth = 3
# ignore = ["**/node_modules/**", "**/build/**", "**/dist/**"]
# scheduler = true            # the service's own five-minute refresh

# Every shipped provider is on unless configuration turns it off.
# \`enabled\` narrows the list; \`disabled\` subtracts from whatever is left.
[providers]
# enabled = ["filesystem", "git", "td", "stack", "tech-signatures", "loc", "endoflife", "github"]
disabled = []

[providers.filesystem]
# forget_missing_after_days = 7

[providers.github]
# Owners — users or organisations — whose repositories are catalogued even when nothing local
# claims them. Empty means "only what is checked out here".
discover = []
# include_forks = false
# include_archived = false

[providers.endoflife]
# max_age_hours = 24

[host]
# How \`serve\`, \`scan\`, \`restart\`, \`stop\`, and \`logs\` reach the machine.
adapter = ${JSON.stringify(template.hostAdapter)}
# label = "com.example.ongoing"   # the launchd adapter's agent label, when it is not discoverable

[export]
# profile = "json"
`;
}

/** The settings written under `[providers.<name>]`, or an empty table. */
export function providerSettings(file: FileConfig, provider: string): ProviderSettings {
  const value = file.providers?.[provider];
  return Array.isArray(value) || value === undefined ? {} : value;
}
