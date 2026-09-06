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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVICE = 'com.marcusvorwaller.ongoing';
const SCAN_SERVICE = `${SERVICE}.scan`;
const LOG_DIR = join(homedir(), 'Library/Logs/Ongoing');
const SESSION_FILE = join(homedir(), '.config/ongoing/session');
const DEFAULT_URL = 'http://127.0.0.1:7766';
const REQUEST_TIMEOUT_MS = 20_000;
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
  name: string;
  canonicalPath: string;
  relativePath: string;
  isFavorite: boolean;
  isHidden: boolean;
  isMissing: boolean;
  note: string;
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
    'file'
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

class Client {
  constructor(private readonly base: string) {}

  get url(): string {
    return this.base;
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
    if (!response.ok && !(options.allowStatus ?? []).includes(response.status)) {
      const detail = await response.text();
      let message = detail.slice(0, 400);
      try {
        message = (JSON.parse(detail) as { error?: string }).error ?? message;
      } catch {
        /* non-JSON error bodies are shown verbatim */
      }
      throw new CliError(
        `${options.method ?? 'GET'} ${path} failed (${response.status}): ${message}`
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
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

async function fetchPage(client: Client, args: Args, hidden = false): Promise<PageModel> {
  return client.request<PageModel>('/api/projects', {
    query: {
      hidden: hidden ? 'true' : undefined,
      view: choice(option(args, 'view'), VIEWS, '--view'),
      filter: choice(option(args, 'filter'), FILTERS, '--filter'),
      sort: choice(option(args, 'sort'), SORTS, '--sort'),
      stack: choice(option(args, 'stack'), TOOLCHAINS, '--stack'),
      dir: flag(args, 'asc') ? 'asc' : flag(args, 'desc') ? 'desc' : undefined,
      q: option(args, 'search', 'q'),
      group: flag(args, 'no-group') ? 'none' : undefined
    }
  });
}

function matches(project: Project, token: string): boolean {
  const needle = token.toLocaleLowerCase('en');
  return (
    project.id === token ||
    project.name.toLocaleLowerCase('en') === needle ||
    project.relativePath.toLocaleLowerCase('en') === needle ||
    project.canonicalPath === token
  );
}

/** Accepts an id, an exact name or path, `.` for the working directory, or a unique substring. */
async function resolveProject(client: Client, token: string): Promise<Project> {
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

async function commandList(client: Client, args: Args): Promise<void> {
  const hidden = flag(args, 'hidden');
  const page = await fetchPage(client, args, hidden);
  let projects = page.visibleProjects;
  const limit = Number(option(args, 'limit', 'n') ?? NaN);
  if (Number.isFinite(limit)) projects = projects.slice(0, Math.max(0, limit));

  if (flag(args, 'json')) return printJson(projects);
  if (flag(args, 'paths')) return void projects.forEach((project) => out(project.canonicalPath));
  if (flag(args, 'ids')) return void projects.forEach((project) => out(project.id));

  if (!projects.length) {
    out(dim(hidden ? 'No hidden projects.' : 'No projects match.'));
    return;
  }

  const nameWidth = Math.min(32, Math.max(12, ...projects.map((project) => project.name.length)));
  out(
    dim(
      `  ${pad('project', nameWidth)} ${padStart('last', 5)} ${padStart('30d', 4)} ` +
        `${padStart('loc', 6)} ${padStart('td', 4)} ${padStart('★', 6)}  views`
    )
  );
  for (const project of projects) {
    const metrics = project.metrics;
    const marker = project.isFavorite ? yellow('★') : ' ';
    const name = project.isMissing ? red(project.name) : bold(project.name);
    const views = project.views.map((view) => VIEW_STYLE[view](VIEW_LABEL[view])).join(', ');
    out(
      `${marker} ${pad(name, nameWidth)} ${padStart(age(metrics?.latestCommitAt), 5)} ` +
        `${padStart(count(metrics?.commits30d), 4)} ${padStart(count(metrics?.locCode), 6)} ` +
        `${padStart(count(metrics?.tdTotalNonClosedCount), 4)} ` +
        `${padStart(count(metrics?.githubStars), 6)}  ${views}`
    );
  }
  const summary = hidden
    ? `${projects.length} hidden`
    : `${projects.length} of ${page.totalCount} projects · ${page.hiddenCount} hidden`;
  out(dim(`\n${summary} · scanned ${age(page.scan?.finishedAt ?? page.scan?.startedAt)} ago`));
}

async function commandShow(client: Client, args: Args): Promise<void> {
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

  const label = Math.max(...[...facts, ...decisions].map(([key]) => key.length));
  for (const [key, value] of facts) out(`${dim(pad(key, label))}  ${value}`);
  out();
  for (const [key, value] of decisions) out(`${dim(pad(key, label))}  ${value}`);

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

async function commandViews(client: Client, args: Args): Promise<void> {
  const page = await client.request<PageModel>('/api/projects');
  if (flag(args, 'json')) return printJson(page.viewCounts);
  for (const view of VIEWS)
    out(
      `${VIEW_STYLE[view](pad(VIEW_LABEL[view], 16))} ${padStart(String(page.viewCounts[view]), 4)}`
    );
  out(dim(`\n${page.totalCount} projects · ${page.hiddenCount} hidden`));
}

/**
 * `ongoing stacks` — the catalog-wide toolchain roll-up, and `ongoing stacks <toolchain>` for the
 * per-project breakdown. Computed from the same page payload the dashboard renders, so `--view`,
 * `--filter`, and `--search` narrow it exactly as they narrow `ongoing list`.
 */
async function commandStacks(client: Client, args: Args): Promise<void> {
  const toolchain = choice(args.positional[0], TOOLCHAINS, 'toolchain');
  const page = await fetchPage(client, args, flag(args, 'hidden'));
  const outdatedOnly = flag(args, 'outdated');
  const isOutdated = (stack: Stack) => stack.status === 'behind' || stack.status === 'eol';

  if (toolchain) {
    const rows = page.visibleProjects
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
  for (const project of page.visibleProjects)
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

async function commandFavorite(client: Client, args: Args): Promise<void> {
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

async function commandHide(client: Client, args: Args, hidden: boolean): Promise<void> {
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

async function commandForget(client: Client, args: Args): Promise<void> {
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

async function commandPrune(client: Client, args: Args): Promise<void> {
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

async function commandNote(client: Client, args: Args): Promise<void> {
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

async function commandWebsite(client: Client, args: Args): Promise<void> {
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

async function commandSet(client: Client, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'set');
  const body: Record<string, unknown> = {};
  const intent = option(args, 'intent');
  if (intent !== undefined)
    body.intent = nullable(intent) ? choice(intent, INTENTS, '--intent') : null;
  for (const [flagName, field] of [
    ['excitement', 'excitement'],
    ['importance', 'strategicImportance']
  ] as const) {
    const raw = option(args, flagName);
    if (raw === undefined) continue;
    if (!nullable(raw)) {
      body[field] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 5)
      throw new CliError(`--${flagName} must be an integer from 1 through 5, or none`);
    body[field] = value;
  }
  const nextAction = option(args, 'next-action');
  if (nextAction !== undefined) body.nextAction = nullable(nextAction) ? nextAction : null;
  const reviewAfter = option(args, 'review-after');
  if (reviewAfter !== undefined) body.reviewAfter = nullable(reviewAfter) ? reviewAfter : null;

  if (!Object.keys(body).length)
    throw new CliError(
      'Nothing to set. Use --intent, --excitement, --importance, --next-action, or --review-after.'
    );
  await client.request(`/api/projects/${project.id}`, { method: 'PATCH', body });
  report(args, { id: project.id, ...body }, `${project.name} updated: ${describe(body)}`);
}

/** `none`, `null`, and `-` all mean "clear this field". */
function nullable(value: string): boolean {
  return value !== 'none' && value !== 'null' && value !== '-' && value !== '';
}

function describe(body: Record<string, unknown>): string {
  return Object.entries(body)
    .map(([key, value]) => `${key}=${value === null ? 'none' : value}`)
    .join(' ');
}

async function commandScan(client: Client, args: Args): Promise<void> {
  const token = args.positional[0];
  const project = token ? await resolveProject(client, token) : null;
  const refresh = flag(args, 'full') ? 'full' : flag(args, 'cheap') ? 'cheap' : undefined;
  const started = await client.request<{ runId: string; status: string }>('/api/scan', {
    method: 'POST',
    body: { projectId: project?.id, refresh }
  });
  if (!flag(args, 'wait')) {
    report(args, started, `scan ${started.runId} started${project ? ` for ${project.name}` : ''}`);
    return;
  }
  const finished = await waitForScan(client);
  if (flag(args, 'json')) return printJson(finished);
  if (!finished) return out(dim(`scan ${started.runId} is still running`));
  out(
    `scan ${finished.status === 'completed' ? green(finished.status) : red(finished.status)} · ` +
      `${finished.discoveredCount} discovered · ${finished.updatedCount} updated · ${finished.errorCount} errors`
  );
  if (finished.status !== 'completed') process.exitCode = 1;
}

/** Polls the latest run until it settles; a settled newer run means ours already finished. */
async function waitForScan(client: Client, timeoutMs = 900_000): Promise<ScanRun | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 2_000));
    const scan = (await client.request<PageModel>('/api/projects')).scan;
    if (scan && scan.status !== 'running') return scan;
  }
  return null;
}

async function commandOpen(client: Client, args: Args): Promise<void> {
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

async function commandPath(client: Client, args: Args): Promise<void> {
  const project = await requireProject(client, args, 'path');
  out(project.canonicalPath);
}

async function commandStatus(client: Client, args: Args): Promise<void> {
  const web = launchdState(SERVICE);
  const scanner = launchdState(SCAN_SERVICE);
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
    health,
    web,
    scanner,
    projects: page?.totalCount ?? null,
    hidden: page?.hiddenCount ?? null,
    lastScan: page?.scan ?? null
  };
  if (flag(args, 'json')) return printJson(status);

  const label = 12;
  out(`${dim(pad('url', label))}  ${client.url}`);
  out(`${dim(pad('health', label))}  ${health === 'ok' ? green('ok') : red(health)}`);
  out(
    `${dim(pad('web agent', label))}  ${web.running ? green(web.state) : red(web.state)} ${dim(SERVICE)}`
  );
  out(
    `${dim(pad('scan agent', label))}  ${scanner.running ? green(scanner.state) : dim(scanner.state)} ${dim(SCAN_SERVICE)}`
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

interface LaunchdState {
  label: string;
  state: string;
  running: boolean;
  pid: number | null;
}

function launchdState(label: string): LaunchdState {
  const result = spawnSync('launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${label}`], {
    encoding: 'utf8'
  });
  if (result.status !== 0) return { label, state: 'not loaded', running: false, pid: null };
  const state = /^\s*state = (.+)$/m.exec(result.stdout)?.[1]?.trim() ?? 'unknown';
  const pid = Number(/^\s*pid = (\d+)$/m.exec(result.stdout)?.[1] ?? NaN);
  return { label, state, running: state === 'running', pid: Number.isFinite(pid) ? pid : null };
}

function run(command: string, argv: string[], options: { cwd?: string } = {}): number {
  const result = spawnSync(command, argv, { stdio: 'inherit', cwd: options.cwd ?? REPO });
  if (result.error) throw new CliError(`${command} failed: ${result.error.message}`);
  return result.status ?? 1;
}

function serviceLabel(args: Args): string {
  return flag(args, 'scan') ? SCAN_SERVICE : SERVICE;
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function commandRestart(args: Args): Promise<void> {
  const label = serviceLabel(args);
  if (flag(args, 'build') && label === SERVICE) {
    out(dim('building…'));
    if (run('bun', ['run', 'build']) !== 0)
      throw new CliError('build failed; service left running');
  }
  const domain = `gui/${process.getuid?.() ?? 501}`;
  // bootout + bootstrap (rather than kickstart) so plist edits are picked up — see AGENTS.md.
  spawnSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });

  // bootout is asynchronous: bootstrapping before launchd has finished tearing the job down
  // fails with "Input/output error", so wait for the label to disappear and retry a few times.
  for (let attempt = 0; attempt < 10 && launchdState(label).state !== 'not loaded'; attempt += 1)
    await wait(300);
  const plist = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
    if (result.status === 0) {
      out(`${green('restarted')} ${label}`);
      return;
    }
    if (attempt === 5)
      throw new CliError(
        `launchctl bootstrap ${label} exited ${result.status}: ${(result.stderr || '').trim()}`
      );
    await wait(500);
  }
}

function commandStop(args: Args): void {
  const label = serviceLabel(args);
  const status = run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${label}`]);
  out(status === 0 ? `${green('stopped')} ${label}` : dim(`${label} was not loaded`));
}

function commandLogs(args: Args): void {
  const files = flag(args, 'scan')
    ? [join(LOG_DIR, 'scan-stdout.log'), join(LOG_DIR, 'scan-stderr.log')]
    : [join(LOG_DIR, 'stdout.log'), join(LOG_DIR, 'stderr.log')];
  const lines = option(args, 'lines') ?? '50';
  const argv = ['-n', lines, ...(flag(args, 'f', 'follow') ? ['-f'] : []), ...files];
  const child = spawn('tail', argv, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/* -------------------------------------------------------------------- shell */

async function requireProject(client: Client, args: Args, command: string): Promise<Project> {
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
  list, ls                              list projects
      --view <${VIEWS.join('|')}>
      --filter <${FILTERS.join('|')}>
      --stack <${TOOLCHAINS.join('|')}>
      --sort <key> --asc|--desc         sort keys: ${SORTS.join(', ')}
      -q, --search <text>               match name, path, or note
      -n, --limit <count>               show only the first N
      --hidden                          list the hidden shelf instead
      --paths | --ids | --json          machine-readable output
  show <project>                        one project in full, with attention reasons
  views                                 attention view counts
  stacks [toolchain] [--outdated]       declared toolchains, versions, and upgrade pressure
  status                                service, scan, and catalog health
  path <project>                        print the project directory

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
  set <project> [--intent <${INTENTS.join('|')}>]
                [--excitement 1-5] [--importance 1-5]
                [--next-action <text>] [--review-after YYYY-MM-DD]
                                        any value may be "none" to clear it
  scan [project] [--full|--cheap] [--wait]
                                        refresh the catalog

${bold('Local')}
  open [project] [--terminal|--github]  open the dashboard, or reveal a project
  logs [-f] [--lines N] [--scan]        tail the service logs
  restart [--build] [--scan]            reload the LaunchAgent
  stop [--scan]                         unload the LaunchAgent
  build                                 rebuild the production bundle
  dev                                   run the development server
  repo                                  print the repository directory
  login                                 exchange ONGOING_ACCESS_SECRET for a session

${bold('Projects')} may be named by id, name, path, a unique substring, or "." for the current directory.

${bold('Options')}
  --url <base>                          dashboard base URL (env ONGOING_URL, default ${DEFAULT_URL})
  --json                                JSON output
  -h, --help · --version
`;

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positional.shift() ?? 'list';

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
  }

  const client = new Client(baseUrl(args));
  switch (command) {
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
    case 'website':
      return commandWebsite(client, args);
    case 'scan':
      return commandScan(client, args);
    case 'open':
      return commandOpen(client, args);
    case 'login': {
      const secret = args.positional[0] ?? process.env.ONGOING_ACCESS_SECRET;
      if (!secret)
        throw new CliError('Usage: ongoing login <secret> (or set ONGOING_ACCESS_SECRET)');
      if (!(await client.login(secret))) throw new CliError('The access secret was not accepted.');
      return out(`${green('✓')} session saved to ${SESSION_FILE}`);
    }
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
