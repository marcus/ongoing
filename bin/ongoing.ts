/**
 * ongoing — terminal client for the Ongoing dashboard.
 *
 * Everything the dashboard can do, this can do, because it goes through the same HTTP API rather
 * than opening the SQLite catalog directly. The only commands that touch the machine instead of
 * the API are the service commands (build/restart/logs/dev), which are documented in AGENTS.md.
 *
 * Reached through `bin/ongoing`, normally symlinked onto PATH as `ongoing`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
// The domain layer is import-safe under bare Bun (no $lib aliases, no SvelteKit), so the CLI runs
// the same validation the API and the browser run rather than a second copy of the rules.
import {
  createFieldRegistry,
  parseFieldInput,
  validateEntryPatch,
  type FieldDefinition,
  type FieldRegistry
} from '../src/lib/domain/fields';
import {
  filterRows,
  formatSort,
  legacyParamsToQuery,
  listDefaultClauses,
  parseColumns,
  parseQuery,
  parseSortInput,
  validateQuery
} from '../src/lib/domain/query';
import { relationKinds } from '../src/lib/domain/relation';
import {
  reviewAfterFrom,
  ringOrder,
  seedFields,
  technologyExport,
  technologyRings,
  technologySeeds,
  TECHNOLOGY_KIND,
  technologyKinds,
  type TechnologySeed,
  type UsedTechnology
} from '../src/lib/domain/technology';
import type { AttributeValue } from '../src/lib/domain/entry';
import type { HostAdapter, HostService } from '../src/lib/host/adapter';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
// Service labels and log paths belong to the host adapter now (`src/lib/host/`), not to the CLI.
const SESSION_FILE = join(homedir(), '.config/ongoing/session');
const DEFAULT_URL = 'http://127.0.0.1:7766';
const REQUEST_TIMEOUT_MS = 20_000;
// Long enough for a loopback service to answer, short enough that a dead port is not a pause.
const PROBE_TIMEOUT_MS = 1_500;
const VERSION = '1.0.0';

const VIEWS = [
  'attention',
  'rising',
  'quickwin',
  'opportunity',
  'momentum',
  'dormant',
  'upgrade'
] as const;
const FILTERS = ['all', 'favorites', 'missing', 'warnings', 'local'] as const;
const INTENTS = ['invest', 'maintain', 'experiment', 'hibernate', 'archive'] as const;
const SORTS = [
  'manual',
  'latestCommit',
  'commits30d',
  'activeDays30d',
  'linesOfCode',
  'lifetimeCommits',
  'openTdIssues',
  'githubStars',
  'githubStarsGained30d',
  'githubOpenPrs',
  'githubOldestExternalPr',
  'githubTraffic',
  'stackLag',
  'name'
] as const;

// Mirrors src/lib/domain/stack.ts; the CLI runs under bare Bun and cannot import $lib.
const TOOLCHAINS = [
  'go',
  'node',
  'bun',
  'deno',
  'python',
  'ruby',
  'rust',
  'php',
  'elixir',
  'dotnet',
  'java',
  'swift',
  'postgresql'
] as const;

type ViewKey = (typeof VIEWS)[number];
type Toolchain = (typeof TOOLCHAINS)[number];

interface Stack {
  toolchain: Toolchain;
  declared: string;
  raw: string;
  sourceFile: string;
  status: 'current' | 'behind' | 'eol' | 'unknown';
  matchedCycle: string | null;
  cycleLatestRelease: string | null;
  latestCycle: string | null;
  latestRelease: string | null;
  cyclesBehind: number | null;
  eolFrom: string | null;
  baselineFetchedAt: string | null;
}

interface Metrics {
  latestCommitAt: string | null;
  latestCommitSubject: string | null;
  branch: string | null;
  commits30d: number | null;
  commits90d: number | null;
  activeDays30d: number | null;
  commitCount: number | null;
  dirtyFiles: number | null;
  aheadCount: number | null;
  behindCount: number | null;
  locCode: number | null;
  dominantLanguage: string | null;
  tdOpenCount: number | null;
  tdInProgressCount: number | null;
  tdBlockedCount: number | null;
  tdStaleCount: number | null;
  tdTotalNonClosedCount: number | null;
  githubOwner: string | null;
  githubName: string | null;
  githubStars: number | null;
  githubOpenIssues: number | null;
  githubOpenPrs: number | null;
  githubExternalPrs: number | null;
  githubCiState: string | null;
  githubTrafficViews: number | null;
  githubLatestReleaseTag: string | null;
  githubLatestReleaseAt: string | null;
  gitScannedAt: string | null;
  stackScannedAt: string | null;
  githubScannedAt: string | null;
  [key: string]: unknown;
}

interface AttentionReason {
  source: string;
  message: string;
  input: string;
  value: string | number | boolean | null;
  comparison: string;
  threshold: string | number | boolean | null;
}

interface Project {
  id: string;
  slug: string;
  name: string;
  canonicalPath: string;
  relativePath: string;
  isFavorite: boolean;
  isHidden: boolean;
  isMissing: boolean;
  note: string;
  tags: string[];
  attributes: Record<string, unknown>;
  intent: string | null;
  excitement: number | null;
  strategicImportance: number | null;
  nextAction: string | null;
  reviewAfter: string | null;
  lastSeenAt: string;
  metrics: Metrics | null;
  stacks: Stack[];
  views: ViewKey[];
  attention: Record<ViewKey, { member: boolean; reasons: AttentionReason[] }>;
  errors: { collector: string; message: string; occurredAt: string }[];
  githubStarsGained30d: number | null;
  githubTrafficViewsDelta30d: number | null;
}

interface ScanRun {
  id: string;
  reason: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  updatedCount: number;
  errorCount: number;
}

interface PageModel {
  projects: Project[];
  visibleProjects: Project[];
  viewCounts: Record<ViewKey, number>;
  hiddenCount: number;
  totalCount: number;
  scan: ScanRun | null;
  baselines: {
    toolchain: Toolchain;
    availability: string;
    fetchedAt: string;
    message: string | null;
  }[];
  generatedAt: string;
}

class CliError extends Error {}

/* ---------------------------------------------------------------- arguments */

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set([
    'url',
    'view',
    'filter',
    'sort',
    'search',
    'q',
    'limit',
    'n',
    'intent',
    'excitement',
    'importance',
    'next-action',
    'review-after',
    'lines',
    'stack',
    'grace-days',
    'file',
    'field',
    'kind',
    'type',
    'label',
    'description',
    'adapter',
    'role',
    'values',
    'columns',
    'note',
    'slug',
    'evidence',
    'expected',
    'output',
    'saved',
    'tech',
    'ring',
    'tool-surface',
    'name',
    'data-dir',
    'port',
    'bind',
    'host',
    'transport',
    'profile',
    'config',
    'scan-root',
    'roots'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (argument.startsWith('--')) {
      const [name, inline] = splitOnce(argument.slice(2), '=');
      if (inline !== null) flags.set(name, inline);
      else if (valued.has(name) && argv[index + 1] !== undefined) flags.set(name, argv[++index]);
      else flags.set(name, true);
      continue;
    }
    if (argument.startsWith('-') && argument.length > 1) {
      const name = argument.slice(1);
      if (valued.has(name) && argv[index + 1] !== undefined) flags.set(name, argv[++index]);
      else flags.set(name, true);
      continue;
    }
    positional.push(argument);
  }
  return { positional, flags };
}

function splitOnce(value: string, separator: string): [string, string | null] {
  const index = value.indexOf(separator);
  return index === -1 ? [value, null] : [value.slice(0, index), value.slice(index + 1)];
}

function flag(args: Args, ...names: string[]): boolean {
  return names.some((name) => args.flags.get(name) === true || args.flags.get(name) === 'true');
}

function option(args: Args, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === 'string') return value;
    if (value === true) throw new CliError(`--${name} needs a value`);
  }
  return undefined;
}

function choice<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  label: string
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value))
    throw new CliError(`${label} must be one of: ${allowed.join(', ')}`);
  return value as T[number];
}

/* ------------------------------------------------------------------ output */

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, text: string): string =>
  color ? `\u001b[${code}m${text}\u001b[0m` : text;
const bold = (text: string): string => paint('1', text);
const dim = (text: string): string => paint('2', text);
const red = (text: string): string => paint('31', text);
const green = (text: string): string => paint('32', text);
const yellow = (text: string): string => paint('33', text);
const cyan = (text: string): string => paint('36', text);

const VIEW_STYLE: Record<ViewKey, (text: string) => string> = {
  attention: red,
  rising: green,
  quickwin: yellow,
  opportunity: cyan,
  momentum: green,
  dormant: dim,
  upgrade: yellow
};

const VIEW_LABEL: Record<ViewKey, string> = {
  attention: 'needs attention',
  rising: 'rising',
  quickwin: 'quick win',
  opportunity: 'opportunity',
  momentum: 'momentum',
  dormant: 'dormant',
  upgrade: 'upgrade'
};

/** Printable width: column alignment has to ignore the ANSI escapes this file emits on purpose. */
function width(text: string): number {
  // eslint-disable-next-line no-control-regex -- matching our own colour codes is the intent
  return text.replace(/\u001b\[\d+m/g, '').length;
}

function pad(text: string, size: number): string {
  const overflow = width(text) - size;
  if (overflow > 0) return `${text.slice(0, Math.max(0, text.length - overflow - 1))}…`;
  return text + ' '.repeat(size - width(text));
}

function padStart(text: string, size: number): string {
  return ' '.repeat(Math.max(0, size - width(text))) + text;
}

function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return dim('–');
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function age(timestamp: string | null | undefined): string {
  if (!timestamp) return dim('–');
  const elapsed = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(elapsed)) return dim('–');
  const days = Math.floor(elapsed / 86_400_000);
  if (days < 1) return `${Math.max(0, Math.floor(elapsed / 3_600_000))}h`;
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function printJson(value: unknown): void {
  out(JSON.stringify(value, null, 2));
}

/* -------------------------------------------------------------- http client */

function baseUrl(args: Args): string {
  const value = option(args, 'url') ?? process.env.ONGOING_URL ?? DEFAULT_URL;
  return value.replace(/\/$/, '');
}

function readSession(): string | null {
  try {
    return readFileSync(SESSION_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function writeSession(cookie: string): void {
  mkdirSync(dirname(SESSION_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(SESSION_FILE, `${cookie}\n`, { mode: 0o600 });
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  allowStatus?: number[];
}

/**
 * The CLI's transport seam (Decision 1).
 *
 * `ongoing` speaks HTTP to a running service and links the core library in-process when nothing
 * answers, so `ongoing scan` and `ongoing list` work with no daemon. Both transports answer the
 * same paths with the same bodies because the in-process one calls the same library functions the
 * routes call.
 */
interface ApiClient {
  readonly url: string;
  readonly transport: 'http' | 'local';
  request<T>(path: string, options?: ApiOptions): Promise<T>;
  close(): void;
}

/** Turns an API response into a value or a CliError, identically for both transports. */
async function unwrap<T>(
  response: Response,
  method: string,
  path: string,
  allowStatus: number[] = []
): Promise<T> {
  if (!response.ok && !allowStatus.includes(response.status)) {
    const detail = await response.text();
    let message = detail.slice(0, 400);
    try {
      message = (JSON.parse(detail) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error bodies are shown verbatim */
    }
    throw new CliError(`${method} ${path} failed (${response.status}): ${message}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Links the catalog into this process. Nothing is loaded until a command actually needs it. */
class LocalClient implements ApiClient {
  readonly transport = 'local';

  private constructor(
    private readonly api: { request(path: string, init?: ApiOptions): Promise<Response> },
    readonly url: string
  ) {}

  static async open(): Promise<LocalClient> {
    let createLocalApi: typeof import('../src/lib/server/api/local').createLocalApi;
    try {
      ({ createLocalApi } = await import('../src/lib/server/api/local'));
    } catch (error) {
      throw new CliError(
        `No Ongoing service is answering, and the catalog could not be opened in this process ` +
          `(${error instanceof Error ? error.message : error}).\n` +
          `Run \`bun install\` in ${REPO}, start the service with \`ongoing restart\`, or point ` +
          `elsewhere with --url / ONGOING_URL.`
      );
    }
    const api = createLocalApi();
    return new LocalClient(api, api.config.databasePath);
  }

  async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const response = await this.api.request(path, options);
    return unwrap<T>(response, options.method ?? 'GET', path, options.allowStatus);
  }

  close(): void {
    (this.api as { close?: () => void }).close?.();
  }
}

class Client implements ApiClient {
  readonly transport = 'http';

  constructor(private readonly base: string) {}

  get url(): string {
    return this.base;
  }

  close(): void {
    /* nothing to release on the HTTP transport */
  }

  async request<T>(path: string, options: ApiOptions = {}, retry = true): Promise<T> {
    const url = new URL(this.base + path);
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, value);

    const headers: Record<string, string> = { accept: 'application/json', origin: this.base };
    const session = readSession();
    if (session) headers.cookie = session;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
        // A service that is still booting accepts the connection and then stalls; fail instead.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new CliError(
        `Ongoing is not reachable at ${this.base} (${error instanceof Error ? error.message : error}).\n` +
          `Start it with \`ongoing restart\`, or point elsewhere with --url / ONGOING_URL.`
      );
    }

    if (response.status === 401 && retry && (await this.login())) {
      return this.request<T>(path, options, false);
    }
    if (response.status === 401)
      throw new CliError(
        'Ongoing requires authentication. Run `ongoing login` or set ONGOING_ACCESS_SECRET.'
      );
    return unwrap<T>(response, options.method ?? 'GET', path, options.allowStatus);
  }

  /** Exchanges the access secret for a session cookie via the same form action the UI posts. */
  async login(secret = process.env.ONGOING_ACCESS_SECRET): Promise<boolean> {
    if (!secret) return false;
    const response = await fetch(`${this.base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: this.base },
      body: new URLSearchParams({ secret }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('ongoing_session='));
    if (!cookie) return false;
    writeSession(cookie.split(';')[0]);
    return true;
  }
}

/* ------------------------------------------------------------ project lookup */

function matches(project: Project, token: string): boolean {
  const needle = token.toLocaleLowerCase('en');
  return (
    project.id === token ||
    project.slug === needle ||
    `project/${project.slug}` === needle ||
    project.name.toLocaleLowerCase('en') === needle ||
    project.relativePath.toLocaleLowerCase('en') === needle ||
    project.canonicalPath === token
  );
}

/** Accepts an id, an exact name or path, `.` for the working directory, or a unique substring. */
async function resolveProject(client: ApiClient, token: string): Promise<Project> {
  const [visible, hidden] = await Promise.all([
    client.request<PageModel>('/api/projects'),
    client.request<PageModel>('/api/projects', { query: { hidden: 'true' } })
  ]);
  const projects = [
    ...new Map(
      [...visible.projects, ...hidden.projects].map((project) => [project.id, project])
    ).values()
  ];
  if (!projects.length) throw new CliError('The catalog is empty — run `ongoing scan` first.');

  if (token === '.' || token.startsWith('/') || token.startsWith('./') || token.startsWith('~/')) {
    const target = realpathSafe(token === '.' ? process.cwd() : expandHome(token));
    const found = projects.find((project) => realpathSafe(project.canonicalPath) === target);
    if (!found) throw new CliError(`No project in the catalog matches ${target}`);
    return found;
  }

  const exact = projects.filter((project) => matches(project, token));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(token, exact);

  const needle = token.toLocaleLowerCase('en');
  const partial = projects.filter((project) =>
    `${project.name} ${project.relativePath}`.toLocaleLowerCase('en').includes(needle)
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguous(token, partial);

  // A remote-only entry is a project with no local checkout, so it has no path to open, scan, or
  // forget and the project projection does not carry it. Say that, rather than "no such project".
  const remote = (await fetchEntries(client, 'project')).find(
    (entry) => entry.slug === needle || entry.name.toLocaleLowerCase('en') === needle
  );
  if (remote)
    throw new CliError(
      `${entryLabel(remote)} has no local checkout — it was discovered by ` +
        `${remote.sources.map(({ provider }) => provider).join(', ') || 'no provider'}. ` +
        `Use \`ongoing get ${remote.slug}\` or \`ongoing set ${remote.slug} …\`.`
    );
  throw new CliError(`No project matches "${token}". Try \`ongoing list\`.`);
}

function ambiguous(token: string, projects: Project[]): CliError {
  const names = projects
    .slice(0, 10)
    .map((project) => `  ${project.name}  ${dim(project.relativePath)}`);
  return new CliError(`"${token}" matches ${projects.length} projects:\n${names.join('\n')}`);
}

function expandHome(value: string): string {
  return value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

function realpathSafe(value: string): string {
  try {
    return realpathSync(resolvePath(value));
  } catch {
    return resolvePath(value);
  }
}

/* ---------------------------------------------------------------- commands */

/**
 * Builds the query string `ongoing list` sends. Everything a flag used to mean becomes a clause:
 * one grammar, one place it is assembled, and `--json` on the result shows exactly what ran.
 * `kind:project` and the hidden shelf are added only when the query has not already spoken about
 * them, so `ongoing list 'kind:technology'` and `ongoing list 'is_hidden:true'` do what they say.
 */
function buildListQuery(args: Args): string {
  const parts = [
    args.positional.join(' '),
    legacyParamsToQuery({
      kind: option(args, 'kind'),
      view: choice(option(args, 'view'), VIEWS, '--view'),
      filter: choice(option(args, 'filter'), FILTERS, '--filter'),
      stack: choice(option(args, 'stack'), TOOLCHAINS, '--stack'),
      tech: option(args, 'tech'),
      search: option(args, 'search', 'q')
    })
  ].filter(Boolean);
  const defaults = listDefaultClauses(parseQuery(parts.join(' ')), {
    hidden: flag(args, 'hidden')
  });
  return [...defaults, ...parts].join(' ');
}

/**
 * Favourites float to the top unless `--no-group`, which is the old `group=favorites` behaviour
 * expressed as a leading sort key rather than a second pass over the rows.
 */
function buildListSort(args: Args): string {
  const direction = flag(args, 'asc') ? 'asc' : flag(args, 'desc') ? 'desc' : undefined;
  const requested = option(args, 'sort');
  const keys = requested
    ? parseSortInput(requested, direction)
    : parseSortInput('git.latestCommit', direction ?? 'desc');
  const grouped =
    flag(args, 'no-group') || keys.some((key) => key.field === 'is_favorite')
      ? keys
      : [{ field: 'is_favorite', direction: 'desc' as const }, ...keys];
  return formatSort(grouped);
}

function columnValue(entry: EntryView, column: string): string {
  if (column === 'id') return entry.id;
  const value = entry.fields[column];
  if (column.endsWith('latestCommit') && typeof value === 'string') return `${age(value)} ago`;
  return formatValue(value);
}

async function commandList(client: ApiClient, args: Args): Promise<void> {
  const saved = option(args, 'saved');
  const limit = option(args, 'limit', 'n');
  const columns = parseColumns(option(args, 'columns') ?? '');
  const page = await fetchEntryPage(client, {
    q: buildListQuery(args),
    sort: buildListSort(args),
    columns: columns.length ? columns.join(',') : undefined,
    saved,
    limit
  });
  const entries = page.entries;

  if (flag(args, 'count')) return out(String(page.total));
  if (flag(args, 'paths')) return void entries.forEach((entry) => entry.path && out(entry.path));
  if (flag(args, 'ids')) return void entries.forEach((entry) => out(entry.id));
  if (flag(args, 'json')) {
    const chosen = columns.length ? columns : page.columns;
    if (!chosen.length) return printJson(entries);
    return printJson(
      entries.map((entry) =>
        Object.fromEntries([
          ['id', entry.id],
          ['entry', entryLabel(entry)],
          ...chosen.map((column) => [column, entry.fields[column] ?? null])
        ])
      )
    );
  }

  if (!entries.length) {
    out(dim(`No entries match ${page.query ? bold(page.query) : 'the catalog'}.`));
    return;
  }

  const chosen = columns.length ? columns : page.columns;
  if (chosen.length) {
    const widths = chosen.map((column) =>
      Math.min(
        40,
        Math.max(column.length, ...entries.map((entry) => width(columnValue(entry, column))))
      )
    );
    out(dim(chosen.map((column, index) => pad(column, widths[index])).join('  ')));
    for (const entry of entries)
      out(chosen.map((column, index) => pad(columnValue(entry, column), widths[index])).join('  '));
  } else {
    const nameWidth = Math.min(32, Math.max(12, ...entries.map((entry) => entry.name.length)));
    out(
      dim(
        `  ${pad('entry', nameWidth)} ${padStart('last', 5)} ${padStart('30d', 4)} ` +
          `${padStart('loc', 6)} ${padStart('td', 4)} ${padStart('★', 6)}  views`
      )
    );
    for (const entry of entries) {
      const marker = entry.isFavorite ? yellow('★') : ' ';
      const name = entry.isMissing ? red(entry.name) : bold(entry.name);
      const views = (entry.views ?? [])
        .map((view) => VIEW_STYLE[view](VIEW_LABEL[view]))
        .join(', ');
      out(
        `${marker} ${pad(name, nameWidth)} ${padStart(age(entry.fields['git.latestCommit'] as string), 5)} ` +
          `${padStart(count(entry.fields['git.commits30d'] as number), 4)} ` +
          `${padStart(count(entry.fields['loc.code'] as number), 6)} ` +
          `${padStart(count(entry.fields['td.total'] as number), 4)} ` +
          `${padStart(count(entry.fields['github.stars'] as number), 6)}  ${views}`
      );
    }
  }
  out(
    dim(
      `\n${entries.length} of ${page.catalogTotal} · ${page.hiddenCount} hidden · ` +
        `scanned ${age(page.scan?.finishedAt ?? page.scan?.startedAt)} ago`
    )
  );
}

async function commandShow(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token) throw new CliError('Usage: ongoing show <project>');
  const project = await resolveProject(client, token);
  if (flag(args, 'json')) return printJson(project);

  const metrics = project.metrics;
  out(
    `${bold(project.name)}${project.isFavorite ? yellow(' ★') : ''}${project.isHidden ? dim(' (hidden)') : ''}${
      project.isMissing ? red(' (missing)') : ''
    }`
  );
  out(dim(project.canonicalPath));
  out(dim(`id ${project.id}`));
  out();

  const facts: [string, string][] = [
    ['branch', metrics?.branch ?? '–'],
    [
      'last commit',
      metrics?.latestCommitAt
        ? `${age(metrics.latestCommitAt)} ago  ${dim(metrics.latestCommitSubject ?? '')}`
        : '–'
    ],
    [
      'commits',
      `${count(metrics?.commits30d)} in 30d · ${count(metrics?.commits90d)} in 90d · ${count(metrics?.commitCount)} lifetime`
    ],
    [
      'working tree',
      metrics?.dirtyFiles === null || metrics?.dirtyFiles === undefined
        ? '–'
        : `${metrics.dirtyFiles} dirty · ${count(metrics.aheadCount)} ahead · ${count(metrics.behindCount)} behind`
    ],
    ['code', `${count(metrics?.locCode)} lines ${dim(metrics?.dominantLanguage ?? '')}`],
    ['stack', project.stacks.length ? project.stacks.map(describeStack).join(' · ') : '–'],
    [
      'td',
      metrics?.tdTotalNonClosedCount === null || metrics?.tdTotalNonClosedCount === undefined
        ? '–'
        : `${count(metrics.tdTotalNonClosedCount)} open · ${count(metrics.tdBlockedCount)} blocked · ${count(metrics.tdStaleCount)} stale`
    ]
  ];
  if (metrics?.githubOwner)
    facts.push(
      ['github', `${metrics.githubOwner}/${metrics.githubName}`],
      [
        'github activity',
        `${count(metrics.githubStars)} ★ (${signed(project.githubStarsGained30d)} 30d) · ` +
          `${count(metrics.githubOpenPrs)} prs (${count(metrics.githubExternalPrs)} external) · ` +
          `${count(metrics.githubOpenIssues)} issues · ci ${metrics.githubCiState ?? '–'}`
      ],
      [
        'traffic',
        `${count(metrics.githubTrafficViews)} views (${signed(project.githubTrafficViewsDelta30d)} 30d)`
      ]
    );

  const decisions: [string, string][] = [
    ['intent', project.intent ?? '–'],
    ['excitement', project.excitement === null ? '–' : `${project.excitement}/5`],
    ['importance', project.strategicImportance === null ? '–' : `${project.strategicImportance}/5`],
    ['next action', project.nextAction ?? '–'],
    ['review after', project.reviewAfter ?? '–'],
    ['note', project.note || '–']
  ];

  // Anything else the entry carries: fields registered at runtime, shown the moment they have a
  // value, so `ongoing field add` needs no change here to become visible.
  const decided = new Set([
    'intent',
    'excitement',
    'strategic_importance',
    'next_action',
    'manual_rank'
  ]);
  const extra: [string, string][] = Object.entries(project.attributes ?? {})
    .filter(([key]) => !decided.has(key))
    .map(([key, value]) => [key, formatValue(value)]);
  if (project.tags?.length) extra.unshift(['tags', project.tags.join(', ')]);

  const label = Math.max(...[...facts, ...decisions, ...extra].map(([key]) => key.length));
  for (const [key, value] of facts) out(`${dim(pad(key, label))}  ${value}`);
  out();
  for (const [key, value] of decisions) out(`${dim(pad(key, label))}  ${value}`);
  for (const [key, value] of extra) out(`${dim(pad(key, label))}  ${value}`);

  // The radar section: what this project uses, at which version, and on whose word. It reads the
  // entry rather than the project projection, because edges live on entries.
  const entry = (await fetchEntryPage(client, { q: 'kind:project' })).entries.find(
    (candidate) => candidate.id === project.id
  );
  const uses = entry?.technologies ?? [];
  const provides = (entry?.relations.outgoing ?? []).filter(
    (relation) => relation.kind === 'provides'
  );
  if (uses.length || provides.length) {
    out();
    out(bold('uses'));
    const width = Math.max(4, ...uses.map((technology) => technology.name.length));
    for (const technology of uses)
      out(
        `  ${pad(technology.name, width)} ${pad(technology.version ?? dim('unpinned'), 10)} ` +
          `${pad(paintRing(technology.ring), 6)} ${dim(technology.evidence)}` +
          `${technology.sourceFile ? dim(` ${technology.sourceFile}`) : ''}`
      );
    for (const relation of provides) out(`  ${dim('provides')} ${relation.other?.name ?? '?'}`);
  }

  const active = project.views;
  if (active.length) {
    out();
    for (const view of active) {
      out(VIEW_STYLE[view](bold(VIEW_LABEL[view])));
      for (const reason of project.attention[view].reasons)
        out(
          `  ${reason.message} ${dim(`(${reason.input} ${reason.value} ${reason.comparison} ${reason.threshold})`)}`
        );
    }
  }
  if (project.errors.length) {
    out();
    out(red(bold('collector warnings')));
    for (const error of project.errors)
      out(`  ${error.collector}: ${error.message} ${dim(age(error.occurredAt) + ' ago')}`);
  }
}

function signed(value: number | null): string {
  if (value === null) return '–';
  return value > 0 ? `+${value}` : String(value);
}

const STACK_STYLE: Record<Stack['status'], (text: string) => string> = {
  current: green,
  behind: yellow,
  eol: red,
  unknown: dim
};

/** `go 1.22 →1.25` — the declared version plus what it should move to, coloured by status. */
function describeStack(stack: Stack): string {
  const version = stack.declared || '?';
  const target =
    stack.status === 'eol'
      ? ` eol${stack.latestCycle ? `→${stack.latestCycle}` : ''}`
      : stack.status === 'behind'
        ? ` →${stack.latestCycle}`
        : '';
  return STACK_STYLE[stack.status](`${stack.toolchain} ${version}${target}`);
}

/**
 * `ongoing views` — the saved views, built-in and user-defined alike, with how many entries each
 * one currently matches. The counts are evaluated locally with the same pure evaluator the server
 * runs, so listing thirty views costs one request rather than thirty.
 */
async function commandViews(client: ApiClient, args: Args): Promise<void> {
  const [saved, page] = await Promise.all([
    client.request<{ views: SavedView[] }>('/api/views'),
    fetchEntryPage(client)
  ]);
  const registry = createFieldRegistry(page.fields.filter((field) => field.owner === 'user'));
  const rows = saved.views.map((view) => {
    try {
      const parsed = parseQuery(view.query);
      validateQuery(parsed, registry);
      return { ...view, count: filterRows(page.entries, parsed, registry).length, error: null };
    } catch (error) {
      return { ...view, count: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const shown = flag(args, 'all') ? rows : rows.filter((row) => row.count > 0 || !row.builtin);
  if (flag(args, 'json')) return printJson(flag(args, 'all') ? rows : shown);
  if (!shown.length) return out(dim('No saved view matches anything — try `ongoing views --all`.'));

  const nameWidth = Math.max(...shown.map((row) => row.name.length));
  for (const row of shown)
    out(
      `${bold(pad(row.name, nameWidth))} ${padStart(String(row.count), 5)}  ` +
        `${dim(row.query || '(everything)')}${row.builtin ? '' : cyan(' ·user')}` +
        (row.error ? ` ${red(row.error)}` : '')
    );
  out(dim(`\n${page.catalogTotal} entries · ${page.hiddenCount} hidden`));
}

/**
 * `ongoing stacks` — the catalog-wide toolchain roll-up, and `ongoing stacks <toolchain>` for the
 * per-project breakdown. It reads `/api/entries` through the query model, so any clause or flag
 * that narrows `ongoing list` narrows this the same way (`ongoing stacks go 'intent:invest'`).
 */
async function commandStacks(client: ApiClient, args: Args): Promise<void> {
  const toolchain = choice(args.positional[0], TOOLCHAINS, 'toolchain');
  if (toolchain) args.positional.shift();
  const page = await fetchEntryPage(client, {
    q: buildListQuery(args),
    sort: buildListSort(args)
  });
  const outdatedOnly = flag(args, 'outdated');
  const isOutdated = (stack: Stack) => stack.status === 'behind' || stack.status === 'eol';

  if (toolchain) {
    const rows = page.entries
      .flatMap((project) =>
        project.stacks
          .filter((stack) => stack.toolchain === toolchain && (!outdatedOnly || isOutdated(stack)))
          .map((stack) => ({ project, stack }))
      )
      .sort(
        (left, right) =>
          (right.stack.cyclesBehind ?? -1) - (left.stack.cyclesBehind ?? -1) ||
          left.project.name.localeCompare(right.project.name, 'en')
      );
    if (flag(args, 'json'))
      return printJson(
        rows.map(({ project, stack }) => ({ project: project.name, id: project.id, ...stack }))
      );
    if (!rows.length) return out(dim(`No project declares ${toolchain}.`));

    const nameWidth = Math.min(32, Math.max(12, ...rows.map(({ project }) => project.name.length)));
    out(
      dim(
        `${pad('project', nameWidth)}  ${pad('declared', 12)} ${pad('latest', 10)} ${pad('status', 8)} source`
      )
    );
    for (const { project, stack } of rows)
      out(
        `${pad(project.name, nameWidth)}  ${pad(stack.declared || '–', 12)} ` +
          `${pad(stack.latestRelease ?? stack.latestCycle ?? '–', 10)} ` +
          `${pad(STACK_STYLE[stack.status](stack.status), 8)} ${dim(stack.sourceFile)}`
      );
    return;
  }

  const summary = new Map<
    Toolchain,
    { projects: Set<string>; outdated: Set<string>; versions: Map<string, Set<string>> }
  >();
  for (const project of page.entries)
    for (const stack of project.stacks) {
      if (outdatedOnly && !isOutdated(stack)) continue;
      const entry = summary.get(stack.toolchain) ?? {
        projects: new Set<string>(),
        outdated: new Set<string>(),
        versions: new Map<string, Set<string>>()
      };
      entry.projects.add(project.id);
      if (isOutdated(stack)) entry.outdated.add(project.id);
      // Counted per project, not per declaration, so the versions add up to the project column.
      const version = stack.declared || 'unpinned';
      entry.versions.set(version, (entry.versions.get(version) ?? new Set()).add(project.id));
      summary.set(stack.toolchain, entry);
    }

  const rows = [...summary]
    .map(([key, entry]) => ({
      toolchain: key,
      projects: entry.projects.size,
      outdated: entry.outdated.size,
      versions: [...entry.versions]
        .map(([declared, ids]) => ({ declared, projects: ids.size }))
        .sort(
          (left, right) =>
            right.projects - left.projects || left.declared.localeCompare(right.declared, 'en')
        )
    }))
    .sort(
      (left, right) =>
        right.projects - left.projects || left.toolchain.localeCompare(right.toolchain, 'en')
    );

  if (flag(args, 'json')) return printJson(rows);
  if (!rows.length) return out(dim('No toolchains detected — run `ongoing scan` first.'));

  out(
    dim(`${pad('toolchain', 12)} ${padStart('projects', 8)} ${padStart('outdated', 8)}  versions`)
  );
  for (const row of rows)
    out(
      `${pad(row.toolchain, 12)} ${padStart(String(row.projects), 8)} ` +
        `${padStart(row.outdated ? yellow(String(row.outdated)) : dim('0'), 8)}  ` +
        row.versions
          .slice(0, 6)
          .map(({ declared, projects }) => `${declared}${dim(`(${projects})`)}`)
          .join(' · ')
    );

  const stale = page.baselines.filter(({ availability }) => availability !== 'available');
  if (stale.length)
    out(
      dim(
        `\nRelease data unavailable for ${stale.map(({ toolchain: key }) => key).join(', ')} — cached cycles are being reused.`
      )
    );
}

async function commandFavorite(client: ApiClient, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'favorite');
  const favorite = !flag(args, 'off');
  await client.request(`/api/projects/${project.id}/favorite`, {
    method: 'POST',
    body: { favorite }
  });
  report(
    args,
    { id: project.id, favorite },
    `${project.name} ${favorite ? 'favorited' : 'unfavorited'}`
  );
}

async function commandHide(client: ApiClient, args: Args, hidden: boolean): Promise<void> {
  const project = await requireProject(client, args, hidden ? 'hide' : 'unhide');
  const value = hidden ? !flag(args, 'off') : false;
  await client.request(`/api/projects/${project.id}/hide`, {
    method: 'POST',
    body: { hidden: value }
  });
  report(
    args,
    { id: project.id, hidden: value },
    `${project.name} ${value ? 'hidden' : 'unhidden'}`
  );
}

async function commandForget(client: ApiClient, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'forget');
  // A project name may be matched by a unique substring, and forgetting cannot be undone: the
  // note, favourite, intent, and manual rank go with the row. Make the caller name the victim.
  if (!flag(args, 'yes', 'y'))
    throw new CliError(
      `This permanently drops ${project.name} (${project.canonicalPath}) and its note, ` +
        `favourite, intent, and rank.\nRe-run with --yes to confirm.`
    );
  await client.request(`/api/projects/${project.id}`, { method: 'DELETE' });
  report(
    args,
    { id: project.id, name: project.name, forgotten: true },
    `${project.name} forgotten ${dim(`(${project.canonicalPath})`)}`
  );
}

interface PruneResponse {
  dryRun: boolean;
  graceDays: number;
  forgotten: { id: string; name: string; canonicalPath: string; missingSince: string | null }[];
}

async function commandPrune(client: ApiClient, args: Args): Promise<void> {
  // Dry run unless confirmed, so a bare `ongoing prune` reports rather than deletes.
  const dryRun = !flag(args, 'yes', 'y');
  const graceDays = option(args, 'grace-days');
  if (graceDays !== undefined && !/^\d+$/.test(graceDays))
    throw new CliError('--grace-days must be a non-negative integer');
  const response = await client.request<PruneResponse>('/api/projects/prune', {
    method: 'POST',
    body: { dryRun, ...(graceDays === undefined ? {} : { graceDays: Number(graceDays) }) }
  });
  if (flag(args, 'json')) return printJson(response);
  if (!response.forgotten.length) {
    out(dim(`Nothing to prune — no project has been missing for ${response.graceDays} day(s).`));
    return;
  }
  for (const project of response.forgotten)
    out(
      `  ${project.name} ${dim(project.canonicalPath)}` +
        (project.missingSince ? dim(` · missing since ${project.missingSince.slice(0, 10)}`) : '')
    );
  const count = `${response.forgotten.length} project${response.forgotten.length === 1 ? '' : 's'}`;
  out();
  out(
    dryRun
      ? dim(`Would forget ${count} — and its note, favourite, intent, and rank. Re-run with --yes.`)
      : `${green('✓')} forgot ${count}`
  );
}

async function commandNote(client: ApiClient, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'note');
  const rest = args.positional.slice(1).join(' ');
  if (!rest && !flag(args, 'clear')) {
    if (flag(args, 'json')) return printJson({ id: project.id, note: project.note });
    out(project.note || dim('(no note)'));
    return;
  }
  const note = flag(args, 'clear') ? '' : rest;
  await client.request(`/api/projects/${project.id}`, { method: 'PATCH', body: { note } });
  report(args, { id: project.id, note }, `${project.name} note ${note ? 'updated' : 'cleared'}`);
}

async function commandWebsite(client: ApiClient, args: Args): Promise<void> {
  if (args.positional[0] === 'export') {
    return printJson(
      await client.request('/api/website', {
        query: flag(args, 'drafts') ? { drafts: 'true' } : {}
      })
    );
  }
  if (args.positional[0] === 'pages') return printJson(await client.request('/api/website/pages'));
  const page = args.positional[0] === 'page' ? args.positional[1] : undefined;
  if (args.positional[0] === 'page' && !page)
    throw new CliError('Usage: ongoing website page <slug> [--file JSON]');
  const project = page ? null : await requireProject(client, args, 'website');
  const file = option(args, 'file');
  if (flag(args, 'include') && flag(args, 'exclude'))
    throw new CliError('Choose --include or --exclude');
  let patch: Record<string, unknown> = {};
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new CliError('Website file must contain a JSON object');
    patch = parsed as Record<string, unknown>;
  }
  if (flag(args, 'allow-private') && flag(args, 'public-repo-only'))
    throw new CliError('Choose --allow-private or --public-repo-only');
  if (flag(args, 'allow-private')) patch.allowPrivateRepository = true;
  if (flag(args, 'public-repo-only')) patch.allowPrivateRepository = false;
  if (flag(args, 'include')) patch.included = true;
  if (flag(args, 'exclude')) patch.included = false;
  const path = page
    ? `/api/website/pages/${encodeURIComponent(page)}`
    : `/api/projects/${project!.id}/website`;
  const result = Object.keys(patch).length
    ? await client.request(path, { method: 'PATCH', body: patch })
    : await client.request(path);
  printJson(result);
}

/**
 * `ongoing set <entry> <field> <value>` — one verb for every registered field, validated by the
 * same pure function the API and the browser run. The original decision flags stay as aliases.
 */
async function commandSet(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token)
    throw new CliError('Usage: ongoing set <entry> <field> <value>  (or the --intent style flags)');
  const entry = await resolveEntry(client, token);
  const registry = await fetchRegistry(client);
  const patch: Record<string, unknown> = {};

  const field = args.positional[1];
  if (field) {
    const definition = registry.get(field);
    if (!definition) {
      const suggestion = registry.suggest(field, entry.kind);
      throw new CliError(
        `Unknown field: ${field}${suggestion ? ` — did you mean ${suggestion}?` : ''}`
      );
    }
    const raw = args.positional.slice(2).join(' ');
    if (!args.positional[2] && !flag(args, 'clear'))
      throw new CliError(`Usage: ongoing set ${token} ${field} <value>  ("none" clears it)`);
    patch[field] = flag(args, 'clear') ? null : parseFieldInput(definition, raw);
  }

  // The flags this command shipped with, mapped onto their registered field keys.
  for (const [flagName, key] of [
    ['intent', 'intent'],
    ['excitement', 'excitement'],
    ['importance', 'strategic_importance'],
    ['next-action', 'next_action'],
    ['review-after', 'review_after']
  ] as const) {
    const raw = option(args, flagName);
    if (raw === undefined) continue;
    patch[key] = parseFieldInput(registry.get(key)!, raw);
  }

  if (!Object.keys(patch).length)
    throw new CliError(
      'Nothing to set. Name a field, or use --intent, --excitement, --importance, --next-action, or --review-after.'
    );

  // Validated here first: a bad value fails before the round trip, with the API's own message.
  validateEntryPatch(registry, entry.kind, patch);
  const updated = await patchEntry(client, entry, patch);
  report(
    args,
    { entry: entryLabel(updated), ...patch },
    `${updated.name} updated: ${describe(patch)}`
  );
}

function describe(body: Record<string, unknown>): string {
  return Object.entries(body)
    .map(([key, value]) => `${key}=${value === null ? 'none' : value}`)
    .join(' ');
}

/**
 * A scan is the service's job when a service is running — it holds the lease and streams progress
 * to the browser. With nothing running, it is the **host's** job, and the host runs exactly what the
 * local command runs. The scheduled agent forces HTTP so only deployed code touches its catalog.
 */
async function commandScan(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  const project = token ? await resolveProject(client, token) : null;
  const refresh = flag(args, 'full') ? 'full' : flag(args, 'cheap') ? 'cheap' : undefined;
  if (client.transport === 'local') {
    // Release this process's handle first: the host runs the scan the way the agent does, in a
    // process of its own that opens and closes the catalog itself.
    client.close();
    const host = await hostAdapter(args);
    const status = await host.scan({
      projectId: project?.id,
      full: refresh === 'full',
      cheap: refresh === 'cheap'
    });
    if (status !== 0) process.exitCode = status;
    return;
  }
  const started = await client.request<{ runId: string; status: string }>('/api/scan', {
    method: 'POST',
    body: { projectId: project?.id, refresh }
  });
  if (!flag(args, 'wait')) {
    report(args, started, `scan ${started.runId} started${project ? ` for ${project.name}` : ''}`);
    return;
  }
  const finished = await waitForScan(client, started.runId);
  if (!finished || finished.status !== 'completed') process.exitCode = 1;
  if (flag(args, 'json')) return printJson(finished);
  if (!finished) return out(dim(`scan ${started.runId} is still running`));
  out(
    `scan ${finished.status === 'completed' ? green(finished.status) : red(finished.status)} · ` +
      `${finished.discoveredCount} discovered · ${finished.updatedCount} updated · ${finished.errorCount} errors`
  );
  if (finished.status !== 'completed') process.exitCode = 1;
}

/** Polls this run so a later scan cannot hide its failure. */
async function waitForScan(
  client: ApiClient,
  runId: string,
  timeoutMs = 900_000
): Promise<ScanRun | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2_000));
    const scan = await client.request<ScanRun>('/api/scan', { query: { runId } });
    if (scan && scan.status !== 'running') return scan;
  }
  return null;
}

async function commandOpen(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token) {
    run('open', [client.url]);
    return;
  }
  const project = await resolveProject(client, token);
  if (flag(args, 'github')) {
    const metrics = project.metrics;
    if (!metrics?.githubOwner) throw new CliError(`${project.name} has no known GitHub repository`);
    run('open', [`https://github.com/${metrics.githubOwner}/${metrics.githubName}`]);
    return;
  }
  const action = flag(args, 'terminal') ? 'terminal' : 'finder';
  await client.request(`/api/projects/${project.id}`, { method: 'POST', body: { action } });
  report(args, { id: project.id, action }, `opened ${project.name} in ${action}`);
}

async function commandPath(client: ApiClient, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'path');
  out(project.canonicalPath);
}

async function commandStatus(client: ApiClient, args: Args): Promise<void> {
  const host = await hostAdapter(args);
  const web = await host.status('web');
  const scanner = await host.status('scan');
  let health: 'ok' | string;
  let page: PageModel | null = null;
  try {
    await client.request('/api/health');
    health = 'ok';
    page = await client.request<PageModel>('/api/projects');
  } catch (error) {
    health = error instanceof Error ? error.message.split('\n')[0] : 'unreachable';
  }
  const status = {
    url: client.url,
    transport: client.transport,
    host: host.name,
    health,
    web,
    scanner,
    projects: page?.totalCount ?? null,
    hidden: page?.hiddenCount ?? null,
    lastScan: page?.scan ?? null
  };
  if (flag(args, 'json')) return printJson(status);

  const label = 12;
  out(`${dim(pad(client.transport === 'local' ? 'catalog' : 'url', label))}  ${client.url}`);
  out(`${dim(pad('health', label))}  ${health === 'ok' ? green('ok') : red(health)}`);
  out(
    `${dim(pad('web agent', label))}  ${web.running ? green(web.state) : red(web.state)} ${dim(web.label ?? host.name)}`
  );
  out(
    `${dim(pad('scan agent', label))}  ${scanner.running ? green(scanner.state) : dim(scanner.state)} ${dim(scanner.label ?? host.name)}`
  );
  if (page) {
    out(`${dim(pad('projects', label))}  ${page.totalCount} (${page.hiddenCount} hidden)`);
    const scan = page.scan;
    out(
      `${dim(pad('last scan', label))}  ` +
        (scan
          ? `${scan.status === 'completed' ? green(scan.status) : scan.status === 'running' ? yellow(scan.status) : red(scan.status)} · ` +
            `${scan.reason} · ${age(scan.finishedAt ?? scan.startedAt)} ago · ` +
            `${scan.updatedCount} updated · ${scan.errorCount} errors`
          : dim('never'))
    );
    const stale = page.projects.filter((project) => project.errors.length).length;
    if (stale)
      out(`${dim(pad('warnings', label))}  ${yellow(`${stale} projects with collector warnings`)}`);
  }
  out(dim(`${pad('repo', label)}  ${REPO}`));
}

/* ------------------------------------------------------- machine operations */

/**
 * `restart`, `stop`, `logs`, and `serve` go through a host adapter (ADR 0007): `launchd` on macOS,
 * `foreground` anywhere else, chosen by `[host] adapter` in the configuration file, overridden by
 * `ONGOING_HOST_ADAPTER` or `--host`. The CLI knows the five verbs; it does not know launchd.
 */
async function hostAdapter(args: Args): Promise<HostAdapter> {
  const [{ createHostAdapter }, configFile] = await Promise.all([
    import('../src/lib/host/index'),
    import('../src/lib/server/config-file')
  ]);
  let configured = option(args, 'host') ?? process.env.ONGOING_HOST_ADAPTER;
  let label = process.env.ONGOING_LAUNCHD_LABEL;
  try {
    const host = configFile.readConfigFile(configFile.configPathFrom()).config.host;
    configured ??= host?.adapter;
    label ??= host?.label;
  } catch {
    /* an unreadable configuration file must not stop `ongoing logs` */
  }
  return createHostAdapter(configured, { root: REPO, ...(label ? { label } : {}) });
}

function hostService(args: Args): HostService {
  return flag(args, 'scan') ? 'scan' : 'web';
}

function run(command: string, argv: string[], options: { cwd?: string } = {}): number {
  const result = spawnSync(command, argv, { stdio: 'inherit', cwd: options.cwd ?? REPO });
  if (result.error) throw new CliError(`${command} failed: ${result.error.message}`);
  return result.status ?? 1;
}

async function commandRestart(args: Args): Promise<void> {
  const host = await hostAdapter(args);
  if (flag(args, 'build') && hostService(args) === 'web') out(dim('building…'));
  const result = await host.restart(hostService(args), { build: flag(args, 'build') });
  if (!result.ok) throw new CliError(result.message);
  out(`${green('✓')} ${result.message}`);
}

async function commandStop(args: Args): Promise<void> {
  const result = await (await hostAdapter(args)).stop(hostService(args));
  out(result.ok ? `${green('✓')} ${result.message}` : red(result.message));
}

async function commandLogs(args: Args): Promise<void> {
  const target = (await hostAdapter(args)).logs(hostService(args));
  if (!target.files.length) {
    out(dim(target.detail ?? 'This host keeps no log files.'));
    return;
  }
  const lines = option(args, 'lines') ?? '50';
  const argv = ['-n', lines, ...(flag(args, 'f', 'follow') ? ['-f'] : []), ...target.files];
  const child = spawn('tail', argv, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** `[server]` as the configuration file has it, for the values the HTTP boundary reads directly. */
async function configuredServer(): Promise<{ host?: string; port?: number }> {
  const configFile = await import('../src/lib/server/config-file');
  try {
    return configFile.readConfigFile(configFile.configPathFrom()).config.server ?? {};
  } catch {
    return {};
  }
}

/**
 * Runs the application in the foreground. `--data-dir` is the whole of "a fresh install": a
 * directory nobody has written to becomes a catalog on first open, which is what lets a machine
 * with no service manager run Ongoing with no deployment profile at all.
 */
async function commandServe(args: Args): Promise<void> {
  const host = await hostAdapter(args);
  const dataDir = option(args, 'data-dir');
  // The HTTP boundary reads HOST and PORT from its own environment and nothing else, so the
  // configuration file's `[server]` values have to be handed to it here — otherwise `ongoing init
  // --port 7801` would write a port that `ongoing serve` then ignored.
  const server = await configuredServer();
  const port =
    option(args, 'port') ?? (server.port === undefined ? undefined : String(server.port));
  if (port !== undefined && !/^\d+$/.test(port)) throw new CliError('--port must be a number');
  out(
    dim(
      `serving with the ${host.name} host` +
        (dataDir ? ` on ${expandHome(dataDir)}` : '') +
        (port ? `, port ${port}` : '')
    )
  );
  process.exit(
    await host.serve({
      dataDir: dataDir ? expandHome(dataDir) : undefined,
      port: port ? Number(port) : undefined,
      host: option(args, 'bind') ?? server.host,
      build: !flag(args, 'no-build')
    })
  );
}

/* --------------------------------------------------------------------- init */

/**
 * `ongoing init` — the whole of "install it somewhere else".
 *
 * It writes one commented configuration file, makes the data directory, and opens the catalog once
 * so the migrations run; after that `ongoing scan` and `ongoing serve` work with no further
 * ceremony. It refuses to overwrite a configuration file that already exists, because the file is
 * the one place a person's choices live.
 */
async function commandInit(args: Args): Promise<void> {
  const { configPathFrom, renderConfigFile } = await import('../src/lib/server/config-file');
  const configPath = option(args, 'config')
    ? resolvePath(expandHome(option(args, 'config')!))
    : configPathFrom();
  const dataDir = resolvePath(
    expandHome(option(args, 'data-dir') ?? args.positional[0] ?? '~/.local/share/ongoing')
  );
  const roots = (option(args, 'scan-root') ?? option(args, 'roots') ?? '~/code')
    .split(',')
    .map((root) => resolvePath(expandHome(root.trim())))
    .filter(Boolean);
  const port = Number(option(args, 'port') ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new CliError('--port must be a valid TCP port');

  if (existsSync(configPath) && !flag(args, 'force'))
    throw new CliError(
      `${configPath} already exists. Edit it, point somewhere else with --config, or pass --force to replace it.`
    );

  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    configPath,
    renderConfigFile({
      dataDir,
      scanRoots: roots,
      port,
      // A fresh install supervises nothing. Whoever installs a service adapter says so afterwards.
      hostAdapter: 'foreground'
    }),
    { mode: 0o600 }
  );

  // Opening the catalog once is what turns an empty directory into one, so the first `scan` has
  // nothing left to set up.
  process.env.ONGOING_CONFIG = configPath;
  const client = await LocalClient.open();
  try {
    await client.request('/api/health');
  } finally {
    client.close();
  }

  if (flag(args, 'json'))
    return printJson({
      config: configPath,
      dataDir,
      database: join(dataDir, 'ongoing.sqlite'),
      scanRoots: roots,
      port
    });
  out(`${green('✓')} configuration ${bold(configPath)}`);
  out(`${green('✓')} catalog       ${bold(join(dataDir, 'ongoing.sqlite'))}`);
  out(`  scan roots    ${roots.join(', ')}`);
  out();
  out(dim('next:'));
  out(`  ongoing scan          ${dim('# find the repositories under those roots')}`);
  out(`  ongoing list          ${dim('# what it found')}`);
  out(`  ongoing serve         ${dim(`# the browser, on http://127.0.0.1:${port}`)}`);
}

/* -------------------------------------------------------------------- shell */

/* ------------------------------------------------------------------ entries */

interface EntrySourceView {
  provider: string;
  locator: string;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  missingSince: string | null;
}

interface RelationView {
  id: string;
  kind: string;
  evidence: string;
  provider: string | null;
  attributes: Record<string, AttributeValue>;
  note: string | null;
  other: { id: string; kind: string; slug: string; name: string } | null;
}

interface EntryView {
  id: string;
  kind: string;
  slug: string;
  name: string;
  note: string;
  tags: string[];
  isFavorite: boolean;
  isHidden: boolean;
  reviewAfter: string | null;
  path: string | null;
  isMissing: boolean;
  attributes: Record<string, AttributeValue>;
  fields: Record<string, AttributeValue>;
  views: ViewKey[];
  stacks: Stack[];
  technologies: UsedTechnology[];
  errors: { collector: string; message: string; occurredAt: string }[];
  sources: EntrySourceView[];
  relations: { outgoing: RelationView[]; incoming: RelationView[] };
  updatedAt: string;
}

interface SavedView {
  id: string;
  name: string;
  kind: string | null;
  query: string;
  columns: string[];
  position: number;
  builtin: boolean;
}

/** `GET /api/entries` — the one read endpoint, the same one the browser uses. */
interface EntriesPage {
  query: string;
  sort: string;
  columns: string[];
  saved: SavedView | null;
  entries: EntryView[];
  total: number;
  returned: number;
  catalogTotal: number;
  hiddenCount: number;
  fields: FieldDefinition[];
  baselines: {
    toolchain: Toolchain;
    availability: string;
    fetchedAt: string;
    message: string | null;
  }[];
  scan: ScanRun | null;
  generatedAt: string;
}

interface EntryQuery {
  q?: string;
  sort?: string;
  columns?: string;
  saved?: string;
  limit?: string;
}

async function fetchEntryPage(client: ApiClient, query: EntryQuery = {}): Promise<EntriesPage> {
  return client.request<EntriesPage>('/api/entries', { query: { ...query } });
}

async function fetchEntries(client: ApiClient, kind?: string): Promise<EntryView[]> {
  return (await fetchEntryPage(client, kind ? { q: `kind:${kind}` } : {})).entries;
}

/**
 * The registry as the service knows it, including user fields, rebuilt locally so `ongoing set`
 * can reject a bad value before it costs a round trip — the same function the API runs.
 */
async function fetchRegistry(client: ApiClient): Promise<FieldRegistry> {
  const { fields } = await client.request<{ fields: FieldDefinition[] }>('/api/fields');
  return createFieldRegistry(fields.filter((field) => field.owner === 'user'));
}

function entryPath(entry: EntryView): string | null {
  const source = entry.sources.find((candidate) => candidate.provider === 'filesystem');
  return source ? source.locator : null;
}

function entryLabel(entry: EntryView): string {
  return `${entry.kind}/${entry.slug}`;
}

/** Accepts an id, `kind/slug`, a slug, a name, a path, `.`, or a unique substring. */
async function resolveEntry(client: ApiClient, token: string): Promise<EntryView> {
  const entries = await fetchEntries(client);
  if (!entries.length) throw new CliError('The catalog is empty — run `ongoing scan` first.');

  if (token === '.' || token.startsWith('/') || token.startsWith('./') || token.startsWith('~/')) {
    const target = realpathSafe(token === '.' ? process.cwd() : expandHome(token));
    const found = entries.find((entry) => {
      const path = entryPath(entry);
      return path !== null && realpathSafe(path) === target;
    });
    if (!found) throw new CliError(`No entry in the catalog matches ${target}`);
    return found;
  }

  const needle = token.toLocaleLowerCase('en');
  const exact = entries.filter(
    (entry) =>
      entry.id === token ||
      entryLabel(entry) === token ||
      entry.slug === needle ||
      entry.name.toLocaleLowerCase('en') === needle ||
      entryPath(entry) === token
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguousEntries(token, exact);

  const partial = entries.filter((entry) =>
    `${entry.name} ${entry.slug} ${entryPath(entry) ?? ''}`.toLocaleLowerCase('en').includes(needle)
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguousEntries(token, partial);
  throw new CliError(`No entry matches "${token}". Try \`ongoing list\`.`);
}

function ambiguousEntries(token: string, entries: EntryView[]): CliError {
  const names = entries.slice(0, 10).map((entry) => `  ${entry.name}  ${dim(entryLabel(entry))}`);
  return new CliError(`"${token}" matches ${entries.length} entries:\n${names.join('\n')}`);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '–';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * `ongoing get <entry> [field]` — every field an entry carries, stored and projected alike, or one
 * value on stdout for a script to consume.
 */
async function commandGet(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token) throw new CliError('Usage: ongoing get <entry> [field]');
  const entry = await resolveEntry(client, token);
  const key = args.positional[1];

  if (key) {
    const value = entry.fields[key];
    if (value === undefined && !(key in entry.fields)) {
      const registry = await fetchRegistry(client);
      if (!registry.get(key)) {
        const suggestion = registry.suggest(key, entry.kind);
        throw new CliError(
          `Unknown field: ${key}${suggestion ? ` — did you mean ${suggestion}?` : ''}`
        );
      }
    }
    if (flag(args, 'json'))
      return printJson({ entry: entryLabel(entry), field: key, value: value ?? null });
    return out(value === undefined || value === null ? '' : formatValue(value));
  }

  if (flag(args, 'json')) return printJson(entry);

  const registry = await fetchRegistry(client);
  out(
    `${bold(entry.name)} ${dim(entryLabel(entry))}${entry.isFavorite ? yellow(' ★') : ''}${
      entry.isHidden ? dim(' (hidden)') : ''
    }`
  );
  const path = entryPath(entry);
  if (path) out(dim(path));
  out(dim(`id ${entry.id}`));
  out();

  const rows: [string, string][] = [];
  for (const definition of registry.forKind(entry.kind)) {
    const value = entry.fields[definition.key];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && !value.length) continue;
    rows.push([definition.key, formatValue(value)]);
  }
  for (const [attribute, value] of Object.entries(entry.attributes))
    if (!registry.get(attribute))
      rows.push([`${attribute} ${dim('(unregistered)')}`, formatValue(value)]);
  const label = Math.max(8, ...rows.map(([name]) => width(name)));
  for (const [name, value] of rows) out(`${dim(pad(name, label))}  ${value}`);

  const edges = [
    ...entry.relations.outgoing.map(
      (relation) =>
        `${relation.kind} ${relation.other?.name ?? '?'} ${dim(relation.evidence)}${relation.note ? dim(` — ${relation.note}`) : ''}`
    ),
    ...entry.relations.incoming.map(
      (relation) =>
        `${dim('←')} ${relation.other?.name ?? '?'} ${relation.kind} this ${dim(relation.evidence)}`
    )
  ];
  if (edges.length) {
    out();
    out(bold('relations'));
    for (const edge of edges) out(`  ${edge}`);
  }
}

/** `ongoing entry add <kind> <name> [--slug s] [key=value …]` and `ongoing entry list`. */
async function commandEntry(client: ApiClient, args: Args): Promise<void> {
  const action = args.positional[0];
  if (action === 'list') {
    const entries = await fetchEntries(client, option(args, 'kind'));
    if (flag(args, 'json')) return printJson(entries);
    for (const entry of entries) out(`${pad(entryLabel(entry), 32)} ${entry.name}`);
    return;
  }
  if (action === 'remove') {
    const token = args.positional[1];
    if (!token) throw new CliError('Usage: ongoing entry remove <entry> --yes');
    const entry = await resolveEntry(client, token);
    if (!flag(args, 'yes'))
      throw new CliError(
        `Removing ${entryLabel(entry)} is permanent. Re-run with --yes to confirm.`
      );
    const removed = await client.request<{ entry: string }>(
      `/api/entries/${encodeURIComponent(entry.kind)}/${encodeURIComponent(entry.slug)}`,
      { method: 'DELETE' }
    );
    return report(args, removed, `removed ${entryLabel(entry)}`);
  }
  if (action !== 'add') throw new CliError('Usage: ongoing entry add|list|remove');

  const kind = args.positional[1];
  const name = args.positional[2];
  if (!kind || !name) throw new CliError('Usage: ongoing entry add <kind> <name> [key=value …]');
  const registry = await fetchRegistry(client);
  const body: Record<string, unknown> = { kind, name };
  const slug = option(args, 'slug');
  if (slug) body.slug = slug;
  for (const pair of args.positional.slice(3)) {
    const [key, raw] = splitOnce(pair, '=');
    if (raw === null) throw new CliError(`Expected key=value, got ${pair}`);
    const definition = registry.get(key);
    if (!definition) throw new CliError(`Unknown field: ${key}`);
    body[key] = parseFieldInput(definition, raw);
  }
  const created = await client.request<EntryView>('/api/entries', { method: 'POST', body });
  report(args, created, `created ${entryLabel(created)}`);
}

/** `ongoing field list|add|remove` — the registry as a surface, not a migration. */
async function commandField(client: ApiClient, args: Args): Promise<void> {
  const action = args.positional[0] ?? 'list';
  if (action === 'list') {
    const { fields } = await client.request<{ fields: FieldDefinition[] }>('/api/fields', {
      query: { kind: option(args, 'kind') }
    });
    if (flag(args, 'json')) return printJson(fields);
    const width = Math.max(...fields.map((field) => field.key.length));
    for (const field of fields)
      out(
        `${pad(field.key, width)}  ${pad(field.type, 10)} ${pad(field.kinds.join(','), 12)} ${dim(field.owner)}`
      );
    return;
  }
  if (action === 'add') {
    const key = args.positional[1];
    if (!key) throw new CliError('Usage: ongoing field add <key> --type <type> [--label …]');
    const values = option(args, 'values');
    const body: Record<string, unknown> = {
      key,
      type: option(args, 'type') ?? 'text',
      label: option(args, 'label') ?? key,
      description: option(args, 'description'),
      kinds: option(args, 'kind') ? [option(args, 'kind')] : ['*'],
      required: flag(args, 'required')
    };
    if (values) body.options = { values: values.split(',').map((value) => value.trim()) };
    const adapter = option(args, 'adapter');
    if (adapter)
      body.presentation = {
        adapter,
        ...(option(args, 'role') ? { role: option(args, 'role') } : {})
      };
    const created = await client.request<FieldDefinition>('/api/fields', { method: 'POST', body });
    return report(args, created, `registered field ${created.key} (${created.type})`);
  }
  if (action === 'remove') {
    const key = args.positional[1];
    if (!key) throw new CliError('Usage: ongoing field remove <key> --yes');
    if (!flag(args, 'yes'))
      throw new CliError(
        `Removing ${key} deletes its value on every entry. Re-run with --yes to confirm.`
      );
    const removed = await client.request<{ key: string }>('/api/fields', {
      method: 'DELETE',
      query: { key }
    });
    return report(args, removed, `removed field ${key} and its stored values`);
  }
  throw new CliError('Usage: ongoing field list|add|remove');
}

interface AttachmentRead {
  entry: string;
  field: string;
  revision: string | null;
  value: Record<string, unknown> | null;
  document?: unknown;
  poster?: { mediaType: string; base64: string };
  bundleKind?: string;
}

async function commandAttachment(client: ApiClient, args: Args): Promise<void> {
  const action = args.positional.shift();
  const projectId = args.positional.shift();
  const field = option(args, 'field') ?? 'identity.logo';
  if (!action || !['get', 'set', 'export'].includes(action) || !projectId)
    throw new CliError('Usage: ongoing attachment get|set|export <project-id> --field <key>');
  const path = `/api/attachments/${encodeURIComponent(projectId)}/${encodeURIComponent(field)}`;
  if (action === 'set') {
    const file = option(args, 'file');
    if (!file) throw new CliError('attachment set requires --file <bundle.json>');
    const expectedRaw = option(args, 'expected');
    if (expectedRaw === undefined)
      throw new CliError('attachment set requires --expected <revision|none>');
    let bundle: unknown;
    try {
      bundle = JSON.parse(readFileSync(resolvePath(file), 'utf8'));
    } catch (error) {
      throw new CliError(
        `Unable to read attachment bundle: ${error instanceof Error ? error.message : error}`
      );
    }
    const result = await client.request<AttachmentRead>(path, {
      method: 'PUT',
      body: { bundle, expected: expectedRaw === 'none' ? null : expectedRaw }
    });
    if (flag(args, 'json')) return printJson(result);
    return out(`${green('✓')} attached ${field} to ${projectId} at ${result.revision}`);
  }
  const result = await client.request<AttachmentRead>(path);
  if (action === 'get') {
    if (flag(args, 'json')) return printJson(result);
    return out(result.revision ? `${field} ${result.revision}` : `${field} is not set`);
  }
  const output = option(args, 'output');
  if (!output) throw new CliError('attachment export requires --output <directory>');
  if (!result.value || !result.poster || result.document === undefined)
    throw new CliError(`${field} is not set for ${projectId}`);
  const directory = resolvePath(output);
  mkdirSync(directory, { recursive: true });
  const bundle = {
    kind: result.bundleKind ?? 'impressions.logo.bundle',
    version: 1,
    document: result.document,
    poster: result.poster
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(result.document, null, 2)}\n`);
  writeFileSync(join(directory, 'poster.png'), Buffer.from(result.poster.base64, 'base64'));
  writeFileSync(join(directory, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  const exported = {
    entry: result.entry,
    field,
    revision: result.revision,
    directory,
    files: ['manifest.json', 'poster.png', 'bundle.json']
  };
  if (flag(args, 'json')) return printJson(exported);
  out(`${green('✓')} exported ${field} to ${directory}`);
}

/**
 * `ongoing tag <entry> [tag …]` adds, `ongoing untag <entry> <tag …>` removes, and a bare
 * `ongoing tag <entry>` reads. Removal is its own verb because `-tag` would parse as a flag.
 */
async function commandTag(client: ApiClient, args: Args, remove: boolean): Promise<void> {
  const token = args.positional[0];
  if (!token)
    throw new CliError(
      remove
        ? 'Usage: ongoing untag <entry> <tag …>'
        : 'Usage: ongoing tag <entry> [tag …] [--clear]'
    );
  const entry = await resolveEntry(client, token);
  const changes = args.positional.slice(1).map((tag) => tag.toLowerCase());
  if (!changes.length && !flag(args, 'clear')) {
    if (remove) throw new CliError('Usage: ongoing untag <entry> <tag …>');
    if (flag(args, 'json')) return printJson({ entry: entryLabel(entry), tags: entry.tags });
    return out(entry.tags.length ? entry.tags.join(' ') : dim('(no tags)'));
  }
  let tags = flag(args, 'clear') ? [] : [...entry.tags];
  if (remove) tags = tags.filter((tag) => !changes.includes(tag));
  else for (const tag of changes) if (!tags.includes(tag)) tags.push(tag);

  const updated = await patchEntry(client, entry, { tags });
  report(
    args,
    { entry: entryLabel(entry), tags: updated.tags },
    `${entry.name} tags: ${updated.tags.join(' ') || '(none)'}`
  );
}

async function patchEntry(
  client: ApiClient,
  entry: EntryView,
  patch: Record<string, unknown>
): Promise<EntryView> {
  return client.request<EntryView>(
    `/api/entries/${encodeURIComponent(entry.kind)}/${encodeURIComponent(entry.slug)}`,
    { method: 'PATCH', body: patch }
  );
}

/** `ongoing link <from> <kind> <to>` and `ongoing unlink <from> <kind> <to>`. */
async function commandLink(client: ApiClient, args: Args, remove: boolean): Promise<void> {
  const [fromToken, kind, toToken] = args.positional;
  if (!fromToken || !kind || !toToken)
    throw new CliError(
      `Usage: ongoing ${remove ? 'unlink' : 'link'} <from> <${relationKinds.map(({ kind: name }) => name).join('|')}> <to>`
    );
  const [from, to] = await Promise.all([
    resolveEntry(client, fromToken),
    resolveEntry(client, toToken)
  ]);
  const body: Record<string, unknown> = { from: from.id, to: to.id, kind };
  if (remove) {
    const result = await client.request<{ id: string }>('/api/relations', {
      method: 'DELETE',
      body
    });
    return report(args, result, `unlinked ${from.name} ${kind} ${to.name}`);
  }
  const note = option(args, 'note');
  if (note) body.note = note;
  const relation = await client.request<RelationView>('/api/relations', { method: 'POST', body });
  report(args, relation, `${from.name} ${kind} ${to.name}`);
}

/** `ongoing view save|list|delete` — the saved query behind a name. */
async function commandView(client: ApiClient, args: Args): Promise<void> {
  const action = args.positional[0] ?? 'list';
  if (action === 'list') {
    const { views } = await client.request<{ views: SavedView[] }>('/api/views');
    if (flag(args, 'json')) return printJson(views);
    if (!views.length) return out(dim('(no saved views)'));
    const width = Math.max(...views.map((view) => view.name.length));
    for (const view of views)
      out(
        `${pad(view.name, width)}  ${view.query || dim('(everything)')} ` +
          `${dim(view.columns.join(','))}${view.builtin ? dim(' built-in') : cyan(' user')}`
      );
    return;
  }
  if (action === 'save') {
    const name = args.positional[1];
    if (!name) throw new CliError('Usage: ongoing view save <name> [query] [--columns a,b]');
    const columns = option(args, 'columns');
    const saved = await client.request<{ name: string }>('/api/views', {
      method: 'POST',
      body: {
        name,
        query: args.positional.slice(2).join(' '),
        kind: option(args, 'kind') ?? null,
        columns: columns ? columns.split(',').map((column) => column.trim()) : []
      }
    });
    return report(args, saved, `saved view ${name}`);
  }
  if (action === 'delete') {
    const name = args.positional[1];
    if (!name) throw new CliError('Usage: ongoing view delete <name>');
    const deleted = await client.request<{ view: string }>('/api/views', {
      method: 'DELETE',
      query: { view: name }
    });
    return report(args, deleted, `deleted view ${name}`);
  }
  throw new CliError('Usage: ongoing view save|list|delete');
}

/* ---------------------------------------------------------------- the radar */

const RING_STYLE: Record<string, (text: string) => string> = {
  hot: green,
  warm: cyan,
  cool: yellow,
  out: red
};

function paintRing(ring: string | null): string {
  if (!ring) return dim('–');
  return (RING_STYLE[ring] ?? dim)(ring);
}

function technologyRow(entry: EntryView): {
  ring: string;
  kind: string;
  usedBy: number;
  stale: boolean;
} {
  return {
    ring: (entry.fields.ring as string) ?? '',
    kind: (entry.fields.technology_kind as string) ?? '',
    usedBy: Number(entry.fields.used_by ?? 0),
    stale: entry.fields.ring_stale === true
  };
}

/** Ring order first — the radar's whole point — then name; never alphabetical on the ring itself. */
function byRing(left: EntryView, right: EntryView): number {
  return (
    ringOrder(left.fields.ring as string) - ringOrder(right.fields.ring as string) ||
    left.name.localeCompare(right.name, 'en')
  );
}

async function fetchTechnologies(client: ApiClient): Promise<EntryView[]> {
  return (await fetchEntries(client, TECHNOLOGY_KIND)).sort(byRing);
}

async function resolveTechnology(client: ApiClient, token: string): Promise<EntryView> {
  const technologies = await fetchTechnologies(client);
  const needle = token.toLocaleLowerCase('en');
  const found =
    technologies.find((entry) => entry.slug === needle || entry.id === token) ??
    technologies.find((entry) => entry.name.toLocaleLowerCase('en') === needle) ??
    technologies.filter((entry) =>
      `${entry.name} ${entry.slug}`.toLocaleLowerCase('en').includes(needle)
    )[0];
  if (!found)
    throw new CliError(
      `No technology matches "${token}". Try \`ongoing tech list\` or \`ongoing tech add ${token} --kind tool --ring warm\`.`
    );
  return found;
}

/** The `uses` edges pointing at one technology, newest declared version first. */
function usageRows(technology: EntryView): {
  project: string;
  version: string;
  evidence: string;
  source: string;
}[] {
  return technology.relations.incoming
    .filter((relation) => relation.kind === 'uses' && relation.other?.kind === 'project')
    .map((relation) => ({
      project: relation.other?.name ?? '?',
      version: (relation.attributes.version as string) ?? '',
      evidence: relation.evidence,
      source: (relation.attributes.sourceFile as string) ?? relation.note ?? ''
    }))
    .sort(
      (left, right) =>
        right.version.localeCompare(left.version, 'en', { numeric: true }) ||
        left.project.localeCompare(right.project, 'en')
    );
}

async function commandTech(client: ApiClient, args: Args): Promise<void> {
  const action = args.positional.shift() ?? 'list';
  switch (action) {
    case 'list':
      return techList(client, args);
    case 'show':
      return techShow(client, args);
    case 'add':
      return techAdd(client, args);
    case 'set':
      return techSet(client, args);
    case 'export':
      return techExport(client, args);
    case 'seed':
      return techSeed(client, args);
    default:
      throw new CliError('Usage: ongoing tech list|show|add|set|export|seed');
  }
}

/**
 * `ongoing tech list` — the radar itself. Every flag is a clause against the same query model
 * `ongoing list` uses, so `ongoing list 'kind:technology ring:out'` is the identical read.
 */
async function techList(client: ApiClient, args: Args): Promise<void> {
  const clauses = ['kind:technology'];
  const ring = choice(option(args, 'ring'), technologyRings, '--ring');
  const kind = choice(option(args, 'kind'), technologyKinds, '--kind');
  if (ring) clauses.push(`ring:${ring}`);
  if (kind) clauses.push(`technology_kind:${kind}`);
  if (flag(args, 'stale')) clauses.push('ring_stale:true');
  if (flag(args, 'unused')) clauses.push('used_by:none,0');
  if (args.positional.length) clauses.push(args.positional.join(' '));

  const page = await fetchEntryPage(client, { q: clauses.join(' ') });
  const technologies = [...page.entries].sort(byRing);
  if (flag(args, 'json')) return printJson(technologies);
  if (!technologies.length)
    return out(dim('No technology matches — seed the catalog with `ongoing tech seed`.'));

  const nameWidth = Math.max(4, ...technologies.map((entry) => entry.name.length));
  out(
    dim(
      `${pad('name', nameWidth)}  ${pad('ring', 6)} ${pad('kind', 10)} ${padStart('used', 4)}  note`
    )
  );
  for (const entry of technologies) {
    const row = technologyRow(entry);
    out(
      `${bold(pad(entry.name, nameWidth))}  ${pad(paintRing(row.ring), 6)} ${pad(row.kind || '–', 10)} ` +
        `${padStart(row.usedBy ? String(row.usedBy) : dim('0'), 4)}  ` +
        `${dim(entry.note || (entry.fields.tool_surface as string) || '')}` +
        (row.stale ? ` ${yellow('· ring stale')}` : '')
    );
  }
  out(dim(`\n${technologies.length} technologies`));
}

/** `ongoing tech show go` — the ring, the note, and every project using it with its version. */
async function techShow(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token) throw new CliError('Usage: ongoing tech show <technology>');
  const technology = await resolveTechnology(client, token);
  const rows = usageRows(technology);
  if (flag(args, 'json'))
    return printJson({
      ...technology,
      usedBy: rows
    });

  const row = technologyRow(technology);
  out(`${bold(technology.name)} ${dim(`technology/${technology.slug}`)}`);
  const facts: [string, string][] = [
    ['ring', `${paintRing(row.ring)}${row.stale ? yellow('  (review overdue)') : ''}`],
    ['kind', row.kind || '–'],
    ['note', technology.note || '–'],
    ['tool surface', (technology.fields.tool_surface as string) || '–'],
    ['review after', technology.reviewAfter ?? '–'],
    ['provided by', (technology.fields.provided_by as string) || '–']
  ];
  const label = Math.max(...facts.map(([key]) => key.length));
  out();
  for (const [key, value] of facts) out(`${dim(pad(key, label))}  ${value}`);

  out();
  if (!rows.length) return out(dim('No project uses it yet.'));
  const projectWidth = Math.max(7, ...rows.map((usage) => usage.project.length));
  out(dim(`${pad('project', projectWidth)}  ${pad('version', 12)} ${pad('evidence', 9)} source`));
  for (const usage of rows)
    out(
      `${pad(usage.project, projectWidth)}  ${pad(usage.version || dim('unpinned'), 12)} ` +
        `${pad(usage.evidence === 'detected' ? usage.evidence : cyan(usage.evidence), 9)} ${dim(usage.source)}`
    );
  out(dim(`\n${rows.length} project${rows.length === 1 ? '' : 's'}`));
}

function technologyPatch(args: Args, registry: FieldRegistry): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [flagName, key] of [
    ['ring', 'ring'],
    ['kind', 'technology_kind'],
    ['note', 'note'],
    ['tool-surface', 'tool_surface'],
    ['review-after', 'review_after'],
    ['name', 'name']
  ] as const) {
    const raw = option(args, flagName);
    if (raw === undefined) continue;
    patch[key] = parseFieldInput(registry.get(key)!, raw);
  }
  return patch;
}

/** `ongoing tech add <slug> --kind K --ring R` — a technology no detector can invent for you. */
async function techAdd(client: ApiClient, args: Args): Promise<void> {
  const slug = args.positional[0];
  if (!slug) throw new CliError('Usage: ongoing tech add <slug> --kind <kind> --ring <ring>');
  const registry = await fetchRegistry(client);
  const patch = technologyPatch(args, registry);
  const body: Record<string, unknown> = {
    kind: TECHNOLOGY_KIND,
    slug,
    name: (patch.name as string) ?? slug,
    ...patch
  };
  if (!body.ring) throw new CliError(`--ring is required (${technologyRings.join(', ')})`);
  if (!body.technology_kind)
    throw new CliError(`--kind is required (${technologyKinds.join(', ')})`);
  const created = await client.request<EntryView>('/api/entries', { method: 'POST', body });
  report(args, created, `created technology/${created.slug} (${body.ring})`);
}

/** `ongoing tech set sveltekit --ring warm` — the ring is the field that actually gets revisited. */
async function techSet(client: ApiClient, args: Args): Promise<void> {
  const token = args.positional[0];
  if (!token)
    throw new CliError('Usage: ongoing tech set <technology> [--ring …] [--note …] [--kind …]');
  const technology = await resolveTechnology(client, token);
  const registry = await fetchRegistry(client);
  const patch = technologyPatch(args, registry);
  if (!Object.keys(patch).length)
    throw new CliError('Nothing to set. Use --ring, --kind, --note, --tool-surface, or --name.');
  validateEntryPatch(registry, TECHNOLOGY_KIND, patch);
  const updated = await patchEntry(client, technology, patch);
  report(
    args,
    { entry: entryLabel(updated), ...patch },
    `${updated.name} updated: ${describe(patch)}`
  );
}

/**
 * `ongoing tech export` — technologies and their edges as one deterministic document, which is what
 * the `project-standards` generator renders. JSON is the whole point, so `--json` is the default.
 */
async function techExport(client: ApiClient, args: Args): Promise<void> {
  const page = await fetchEntryPage(client, { q: '' });
  const document = technologyExport(page.entries, { generatedAt: page.generatedAt });
  if (flag(args, 'pretty')) {
    for (const technology of document.technologies)
      out(
        `${pad(technology.slug, 18)} ${pad(technology.ring ?? '–', 6)} ${padStart(String(technology.projects.length), 4)} ${dim(technology.note)}`
      );
    return;
  }
  printJson(document);
}

interface SeedOutcome {
  slug: string;
  status: 'created' | 'updated' | 'unchanged';
  changed: string[];
  linked: string | null;
}

/**
 * `ongoing tech seed` — the technologies Ongoing ships with, written through the same API any
 * other client uses rather than a migration. It is idempotent by construction: a missing
 * technology is created, a value the catalog has not filled in yet is filled, and a value someone
 * has since changed is left alone unless `--force` says otherwise. Running it twice changes
 * nothing the second time.
 */
async function techSeed(client: ApiClient, args: Args): Promise<void> {
  const file = option(args, 'file');
  const seeds: TechnologySeed[] = file
    ? (JSON.parse(readFileSync(expandHome(file), 'utf8')) as TechnologySeed[])
    : [...technologySeeds];
  const force = flag(args, 'force');
  const registry = await fetchRegistry(client);
  const entries = await fetchEntries(client);
  const bySlug = new Map(
    entries.filter((entry) => entry.kind === TECHNOLOGY_KIND).map((entry) => [entry.slug, entry])
  );
  const projects = new Map(
    entries.filter((entry) => entry.kind === 'project').map((entry) => [entry.slug, entry])
  );
  const reviewAfter = reviewAfterFrom(Date.now());
  const outcomes: SeedOutcome[] = [];

  for (const seed of seeds) {
    const fields = seedFields(seed);
    let entry = bySlug.get(seed.slug);
    const outcome: SeedOutcome = {
      slug: seed.slug,
      status: 'unchanged',
      changed: [],
      linked: null
    };

    if (!entry) {
      const body = { kind: TECHNOLOGY_KIND, slug: seed.slug, ...fields, review_after: reviewAfter };
      validateEntryPatch(registry, TECHNOLOGY_KIND, fields);
      entry = await client.request<EntryView>('/api/entries', { method: 'POST', body });
      outcome.status = 'created';
    } else {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        const current = entry.fields[key];
        const empty = current === undefined || current === null || current === '';
        if (value === null || value === '') continue;
        if (empty || (force && current !== value)) patch[key] = value;
      }
      if (!entry.reviewAfter) patch.review_after = reviewAfter;
      if (Object.keys(patch).length) {
        validateEntryPatch(registry, TECHNOLOGY_KIND, patch);
        entry = await patchEntry(client, entry, patch);
        outcome.status = 'updated';
        outcome.changed = Object.keys(patch);
      }
    }

    // "Provided by project X" is a declared `provides` edge, which is all the project-to-project
    // modelling the plan asks for at this phase.
    const provider = seed.providedBy ? projects.get(seed.providedBy) : undefined;
    const linked =
      provider &&
      !entry.relations.incoming.some(
        (relation) => relation.kind === 'provides' && relation.other?.id === provider.id
      );
    if (provider && linked) {
      await client.request('/api/relations', {
        method: 'POST',
        body: { from: provider.id, to: entry.id, kind: 'provides' }
      });
      outcome.linked = provider.slug;
      if (outcome.status === 'unchanged') outcome.status = 'updated';
    }
    outcomes.push(outcome);
  }

  if (flag(args, 'json')) return printJson({ seeded: outcomes.length, outcomes });
  const counts = {
    created: outcomes.filter((outcome) => outcome.status === 'created').length,
    updated: outcomes.filter((outcome) => outcome.status === 'updated').length,
    unchanged: outcomes.filter((outcome) => outcome.status === 'unchanged').length
  };
  for (const outcome of outcomes.filter((candidate) => candidate.status !== 'unchanged'))
    out(
      `${green('✓')} ${pad(outcome.slug, 18)} ${outcome.status}` +
        `${outcome.changed.length ? dim(` ${outcome.changed.join(', ')}`) : ''}` +
        `${outcome.linked ? dim(` · provided by ${outcome.linked}`) : ''}`
    );
  out(
    dim(
      `${counts.created} created · ${counts.updated} updated · ${counts.unchanged} already current`
    )
  );
}

/* ---------------------------------------------------------------- providers */

interface ProviderReport {
  name: string;
  enabled: boolean;
  available: boolean;
  state: 'active' | 'disabled' | 'unavailable';
  reason: string | null;
  schedule: string;
  description: string;
  kinds: string[];
  dependsOn: string[];
  requires: { commands: string[]; env: string[]; network: boolean };
  fields: string[];
  relations: string[];
  settings: Record<string, unknown>;
  lastRun: string | null;
  lastRunStatus: string | null;
  lastRunDetail: string | null;
}

interface ProvidersPage {
  providers: ProviderReport[];
  host: string;
  configPath: string | null;
}

function paintState(state: string): string {
  return state === 'active' ? green(state) : state === 'disabled' ? dim(state) : yellow(state);
}

/**
 * Every provider's manifest, its availability, when it last ran, and what it contributes — the
 * surface ADR 0007 promises, and the same payload the providers page renders.
 */
async function commandProviders(client: ApiClient, args: Args): Promise<void> {
  const page = await client.request<ProvidersPage>('/api/providers');
  const name = args.positional[0];
  const providers = name
    ? page.providers.filter((provider) => provider.name === name)
    : page.providers;
  if (name && !providers.length) throw new CliError(`Unknown provider: ${name}`);
  if (flag(args, 'json')) return printJson(name ? providers[0] : page);

  if (name || flag(args, 'verbose')) {
    for (const provider of providers) {
      out(`${bold(provider.name)}  ${paintState(provider.state)}`);
      out(`  ${dim(provider.description)}`);
      const label = 12;
      out(`  ${dim(pad('schedule', label))}${provider.schedule}`);
      out(`  ${dim(pad('kinds', label))}${provider.kinds.join(', ')}`);
      if (provider.dependsOn.length)
        out(`  ${dim(pad('depends on', label))}${provider.dependsOn.join(', ')}`);
      const requires = [
        ...provider.requires.commands,
        ...provider.requires.env.map((entry) => `$${entry}`),
        ...(provider.requires.network ? ['network'] : [])
      ];
      out(`  ${dim(pad('requires', label))}${requires.join(', ') || dim('nothing')}`);
      out(
        `  ${dim(pad('last run', label))}${provider.lastRun ? `${age(provider.lastRun)} ago · ${provider.lastRunStatus}` : dim('never')}`
      );
      if (provider.reason) out(`  ${dim(pad('why not', label))}${yellow(provider.reason)}`);
      if (provider.lastRunDetail && provider.lastRunDetail !== provider.reason)
        out(`  ${dim(pad('detail', label))}${provider.lastRunDetail}`);
      out(`  ${dim(pad('fields', label))}${provider.fields.join(' ') || dim('none')}`);
      if (provider.relations.length)
        out(`  ${dim(pad('relations', label))}${provider.relations.join(' ')}`);
      if (Object.keys(provider.settings).length)
        out(`  ${dim(pad('settings', label))}${JSON.stringify(provider.settings)}`);
      out();
    }
    return;
  }

  const rows = providers.map((provider) => ({
    name: provider.name,
    state: provider.state,
    schedule: provider.schedule,
    lastRun: provider.lastRun ? `${age(provider.lastRun)} ago` : 'never',
    fields: provider.fields.length ? String(provider.fields.length) : '–',
    note: provider.reason ?? provider.description
  }));
  const widths = {
    name: Math.max(8, ...rows.map((row) => width(row.name))),
    state: Math.max(5, ...rows.map((row) => width(row.state))),
    schedule: Math.max(8, ...rows.map((row) => width(row.schedule))),
    lastRun: Math.max(8, ...rows.map((row) => width(row.lastRun))),
    fields: 6
  };
  out(
    dim(
      `${pad('PROVIDER', widths.name)}  ${pad('STATE', widths.state)}  ${pad('SCHEDULE', widths.schedule)}  ` +
        `${pad('LAST RUN', widths.lastRun)}  ${padStart('FIELDS', widths.fields)}  NOTE`
    )
  );
  for (const row of rows)
    out(
      `${pad(row.name, widths.name)}  ${paintState(row.state)}${' '.repeat(Math.max(0, widths.state - width(row.state)))}  ` +
        `${pad(row.schedule, widths.schedule)}  ${pad(row.lastRun, widths.lastRun)}  ` +
        `${padStart(row.fields, widths.fields)}  ${dim(row.note)}`
    );
  out();
  out(dim(`host adapter: ${page.host} · configuration: ${page.configPath ?? 'defaults only'}`));
}

/* ------------------------------------------------------------------- export */

/**
 * Publishing the catalog is an adapter: `opentangle` is the shape OpenTangle's site build reads and
 * `json` is the generic one beside it. `ongoing website export` is this command with the profile
 * already chosen.
 */
async function commandExport(client: ApiClient, args: Args): Promise<void> {
  const profile = option(args, 'profile') ?? args.positional[0] ?? 'json';
  const payload = await client.request<unknown>('/api/export', {
    query: {
      profile,
      drafts: flag(args, 'drafts') ? 'true' : undefined,
      kind: option(args, 'kind')
    }
  });
  out(flag(args, 'compact') ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
}

async function requireProject(client: ApiClient, args: Args, command: string): Promise<Project> {
  const token = args.positional[0];
  if (!token) throw new CliError(`Usage: ongoing ${command} <project>`);
  return resolveProject(client, token);
}

function report(args: Args, payload: unknown, message: string): void {
  if (flag(args, 'json')) printJson(payload);
  else out(`${green('✓')} ${message}`);
}

const HELP = `${bold('ongoing')} — terminal client for the Ongoing projects dashboard

${bold('Usage')}
  ongoing [list] [options]              list projects (the default command)
  ongoing <command> [arguments]

${bold('Reading')}
  list, ls ['<query>']                  list entries matching a query (projects by default)
      --sort <[-]field,[-]field>        multiple keys; a leading - sorts descending
      --columns <a,b,c>                 render (and, with --json, emit) these fields
      --saved <name>                    start from a saved view's query and columns
      -n, --limit <count>               show only the first N
      --count                           print how many match and stop
      --hidden                          the hidden shelf instead of the dashboard
      --paths | --ids | --json          machine-readable output
      --view <${VIEWS.join('|')}>
      --filter <${FILTERS.join('|')}>
      --stack <${TOOLCHAINS.join('|')}>
      --tech <slug> --kind <kind>       the old flags, kept as clause aliases
      -q, --search <text> --asc|--desc  and the old sort keys, still accepted:
                                        ${SORTS.join(', ')}
  show <project>                        one project in full, with attention reasons
  get <entry> [field]                   every field an entry carries, or one value on stdout
  views [--all]                         saved views, built-in and user, with match counts
  stacks [toolchain] ['<query>'] [--outdated]
                                        declared toolchains, versions, and upgrade pressure
  status                                service, scan, and catalog health
  path <project>                        print the project directory

${bold('Query')} clauses are ANDed: ${dim('field:value')} equals any of a comma list, ${dim('field!:value')} and a
leading ${dim('-')} negate, ${dim('> >= < <=')} compare, ${dim(':~')} contains, ${dim('*')} means "has a value" and
${dim('none')} means "has none". ${dim('tag:')} ${dim('view:')} ${dim('tech:')} ${dim('kind:')} name their fields; anything else
is text matched against name, slug, path, and note.

  ongoing list 'intent:invest,maintain github.stars>=100 -tag:archived' --sort -git.commits30d,name
  ongoing list 'view:upgrade tech:go' --columns name,stack.go,git.latestCommit --json
  ongoing list --saved oss-momentum

${bold('Changing')}
  favorite, fav <project> [--off]       favorite or unfavorite
  hide <project> [--off]                hide; --off unhides
  unhide <project>                      unhide (alias for hide --off)
  note <project> [text] [--clear]       read or write the note
  forget <project> --yes                drop a project from the catalog for good
  prune [--yes] [--grace-days <n>]      forget entries whose directory has been gone a while
                                        (reports without --yes; --grace-days overrides the wait)
  website <project> [--file <json>] [--include|--exclude]
                                        read or patch explicit public copy; new records are drafts
    [--allow-private|--public-repo-only]   private/unknown repo requires explicit public-site override
  website pages                         list managed public pages without local repositories
  website page <slug> [same flags]       create/read/patch a standalone page (draft by default)
  website export [--drafts]              deterministic public JSON (selected projects by default)
  set <entry> <field> <value>           set any registered field ("none" clears it)
  set <project> [--intent <${INTENTS.join('|')}>]
                [--excitement 1-5] [--importance 1-5]
                [--next-action <text>] [--review-after YYYY-MM-DD]
                                        the original flags, kept as field aliases
  scan [project] [--full|--cheap] [--wait]
                                        refresh the catalog

${bold('Catalog')}
  entry list [--kind <kind>]            every entry, projects and technologies alike
  entry add <kind> <name> [--slug s] [key=value …]
                                        catalog something no provider discovers
  entry remove <entry> --yes            drop a hand-made entry (projects use forget)
  field list [--kind <kind>]            the field registry: built-in, provider, and user fields
  field add <key> --type <type> [--label …] [--kind …] [--values a,b] [--required]
      [--adapter <trusted-id>] [--role <role>]
  field remove <key> --yes              drop a user field and every value stored under it
  attachment get <project-id> [--field <key>] [--json]
  attachment set <project-id> --field <key> --file <bundle.json> --expected <revision|none>
  attachment export <project-id> --field <key> --output <directory>
                                        import, inspect, or export a rich field attachment
  tag <entry> [tag …] [--clear]         read or add tags
  untag <entry> <tag …>                 remove tags
  link <entry> <kind> <entry> [--note …]
                                        declare a relation (${relationKinds.map(({ kind }) => kind).join(', ')})
  unlink <entry> <kind> <entry>         remove a declared relation
  view list                             saved views
  view save <name> [query] [--columns a,b] [--kind <kind>]
  view delete <name>

${bold('Radar')}
  tech list ['<query>'] [--ring ${technologyRings.join('|')}] [--kind <kind>]
      [--stale] [--unused] [--json]     the technologies in the catalog, in ring order
  tech show <technology>                ring, note, and every project using it, with versions
  tech add <slug> --kind <kind> --ring <ring> [--name …] [--note …] [--tool-surface …]
  tech set <technology> [--ring …] [--kind …] [--note …] [--tool-surface …] [--review-after …]
  tech seed [--file <json>] [--force]   the technologies Ongoing ships with; idempotent
  tech export [--pretty]                technologies and their edges, deterministic, for generators
  link <project> uses <technology>      a declared edge; detected ones come from a scan

${bold('Providers and export')}
  providers [name] [--verbose] [--json] every provider's manifest: availability, last run,
                                        contributed fields, enable state, and why not
  export [--profile opentangle|json]    publish the catalog through an export profile
      [--drafts] [--kind <kind>] [--compact]

${bold('Local')}
  init [<data-dir>] [--scan-root a,b]   write a commented config.toml and make the catalog
      [--config <file>] [--port N] [--force]
  serve [--data-dir <dir>] [--port N]   run the application in the foreground on this machine
      [--bind <host>] [--no-build]      (a fresh --data-dir is a fresh install)
  open [project] [--terminal|--github]  open the dashboard, or reveal a project
  logs [-f] [--lines N] [--scan]        tail the service logs
  restart [--build] [--scan]            reload the managed service
  stop [--scan]                         stop the managed service
  build                                 rebuild the production bundle
  dev                                   run the development server
  repo                                  print the repository directory
  login                                 exchange ONGOING_ACCESS_SECRET for a session

${bold('Entries')} may be named by id, kind/slug, slug, name, path, a unique substring, or "." for
the current directory. ${bold('Projects')} are entries with kind=project.

${bold('Transport')} is chosen for you: a service answering ${dim('/api/health')} wins, and otherwise the
catalog is opened in this process, so ${dim('scan')} and ${dim('list')} work with no daemon. ${dim('--local')} and
${dim('--remote')} say it outright. ${bold('Configuration')} is ${dim('~/.config/ongoing/config.toml')}
(${dim('--config')} or ${dim('ONGOING_CONFIG')} to point elsewhere), overridden by environment variables.

${bold('Options')}
  --url <base>                          dashboard base URL (env ONGOING_URL, default ${DEFAULT_URL})
  --config <file>                       read this TOML instead of ~/.config/ongoing/config.toml
  --local | --remote                    force the in-process or HTTP transport
  --host <launchd|foreground>           force the host adapter for serve/restart/stop/logs
  --json                                JSON output
  -h, --help · --version
`;

/**
 * Chooses a transport. A service that answers `/api/health` wins, because it owns the catalog's
 * write lock and its scan lease; otherwise the core library is linked into this process so the CLI
 * still works with no daemon. `--url` or `ONGOING_URL` means "talk to that service" and never falls
 * back; `--local` and `--remote` say it outright.
 */
async function createClient(args: Args): Promise<ApiClient> {
  const explicitUrl = Boolean(option(args, 'url') ?? process.env.ONGOING_URL);
  const mode =
    option(args, 'transport') ??
    (flag(args, 'local') ? 'local' : flag(args, 'remote') ? 'http' : undefined) ??
    process.env.ONGOING_TRANSPORT ??
    'auto';
  if (!['auto', 'http', 'local'].includes(mode))
    throw new CliError('--transport must be auto, http, or local');
  if (mode === 'local') return LocalClient.open();
  const base = baseUrl(args);
  if (mode === 'http' || explicitUrl) return new Client(base);
  return (await serviceAnswers(base)) ? new Client(base) : LocalClient.open();
}

/** A short probe: a service that is up answers in a millisecond, and a dead port refuses at once. */
async function serviceAnswers(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    });
    // 401 still means a service is there; the HTTP client knows how to log in.
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positional.shift() ?? 'list';

  // `--config` is the flag ADR 0007 promises beside `ONGOING_CONFIG`. It is set on the environment
  // rather than threaded through, because every reader — the local transport, the host adapters,
  // and the server this process may spawn — already calls `loadRuntimeConfig`, and a child process
  // has to inherit the choice or `ongoing --config x serve` would serve a different catalog.
  const configPath = option(args, 'config');
  if (configPath) process.env.ONGOING_CONFIG = resolvePath(configPath);

  if (flag(args, 'h', 'help') || command === 'help') return out(HELP);
  if (flag(args, 'version') || command === 'version') return out(VERSION);

  switch (command) {
    case 'repo':
      return out(REPO);
    case 'build':
      return void process.exit(run('bun', ['run', 'build']));
    case 'dev':
      return void process.exit(run('bun', ['run', 'dev']));
    case 'logs':
      return commandLogs(args);
    case 'restart':
      return commandRestart(args);
    case 'start':
      return commandRestart(args);
    case 'stop':
      return commandStop(args);
    case 'init':
      return commandInit(args);
    case 'serve':
      return commandServe(args);
    // A session cookie is an HTTP thing: there is nothing to log in to in this process.
    case 'login': {
      const secret = args.positional[0] ?? process.env.ONGOING_ACCESS_SECRET;
      if (!secret)
        throw new CliError('Usage: ongoing login <secret> (or set ONGOING_ACCESS_SECRET)');
      if (!(await new Client(baseUrl(args)).login(secret)))
        throw new CliError('The access secret was not accepted.');
      return out(`${green('✓')} session saved to ${SESSION_FILE}`);
    }
  }

  const client = await createClient(args);
  switch (command) {
    case 'providers':
      return commandProviders(client, args);
    case 'export':
      return commandExport(client, args);
    case 'list':
    case 'ls':
      return commandList(client, args);
    case 'show':
    case 'info':
      return commandShow(client, args);
    case 'stacks':
      return commandStacks(client, args);
    case 'views':
      return commandViews(client, args);
    case 'status':
      return commandStatus(client, args);
    case 'path':
      return commandPath(client, args);
    case 'favorite':
    case 'fav':
      return commandFavorite(client, args);
    case 'hide':
      return commandHide(client, args, true);
    case 'unhide':
      return commandHide(client, args, false);
    case 'forget':
      return commandForget(client, args);
    case 'prune':
      return commandPrune(client, args);
    case 'note':
      return commandNote(client, args);
    case 'set':
      return commandSet(client, args);
    case 'get':
      return commandGet(client, args);
    case 'entry':
      return commandEntry(client, args);
    case 'field':
    case 'fields':
      return commandField(client, args);
    case 'attachment':
    case 'attachments':
      return commandAttachment(client, args);
    case 'tag':
      return commandTag(client, args, false);
    case 'untag':
      return commandTag(client, args, true);
    case 'link':
      return commandLink(client, args, false);
    case 'unlink':
      return commandLink(client, args, true);
    case 'view':
      return commandView(client, args);
    case 'tech':
      return commandTech(client, args);
    case 'website':
      return commandWebsite(client, args);
    case 'scan':
      return commandScan(client, args);
    case 'open':
      return commandOpen(client, args);
    default:
      throw new CliError(`Unknown command: ${command}\nRun \`ongoing help\` for usage.`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${red('error')} ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
