import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { DiscoveredProject, Project } from '$lib/domain/project';
import type { CatalogRepository, ScanLeaseOwnership } from '$lib/server/catalog/repository';
import { runCommand, type CommandRunner } from './process';

const PRUNED_DIRECTORY_NAMES = new Set([
  '.bun',
  '.cache',
  '.data',
  '.git',
  '.gradle',
  '.next',
  '.npm',
  '.nuxt',
  '.pnpm-store',
  '.turbo',
  '.yarn',
  'bower_components',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target'
]);

export interface DiscoveryOptions {
  scanRoots: readonly string[];
  maxDepth?: number;
  ignoreGlobs?: readonly string[];
  timeoutMs?: number;
  runner?: CommandRunner;
  /**
   * Drop projects whose directory is confirmed gone rather than leaving them flagged missing.
   * Off unless explicitly enabled, so forgetting is always a caller's decision.
   */
  forgetMissing?: boolean;
  /** How long a project must stay missing before {@link forgetMissing} removes it. */
  forgetMissingAfterMs?: number;
}

export interface ReconciledDiscovery {
  projects: Project[];
  enrichmentProjects: Project[];
  forgotten: Project[];
}

interface CanonicalRoot {
  configuredPath: string;
  path: string;
}

function isContainedPath(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

export function isPathWithinRoots(candidate: string, roots: readonly string[]): boolean {
  const absoluteCandidate = resolve(candidate);
  return roots.some((root) => isContainedPath(resolve(root), absoluteCandidate));
}

function ignoredByGlob(relativePath: string, globs: readonly Bun.Glob[]): boolean {
  const portablePath = relativePath.split(sep).join('/');
  return globs.some(
    (glob) =>
      glob.match(portablePath) ||
      glob.match(`${portablePath}/`) ||
      glob.match(`${portablePath}/__discovery__`)
  );
}

async function canonicalRoots(scanRoots: readonly string[]): Promise<CanonicalRoot[]> {
  if (scanRoots.length === 0) throw new Error('At least one scan root is required');
  const roots: CanonicalRoot[] = [];
  for (const configuredPath of scanRoots) {
    const absolute = resolve(configuredPath);
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new Error(`Scan root is not a directory: ${absolute}`);
    roots.push({ configuredPath: absolute, path: await realpath(absolute) });
  }
  return roots;
}

async function hasGitMarker(directory: string): Promise<boolean> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (entry.name === '.git' && (entry.isDirectory() || entry.isFile())) return true;
  }
  return false;
}

async function walkRoot(
  root: CanonicalRoot,
  maxDepth: number,
  globs: readonly Bun.Glob[]
): Promise<string[]> {
  const candidates: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (await hasGitMarker(directory)) candidates.push(directory);
    if (depth >= maxDepth) return;

    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || PRUNED_DIRECTORY_NAMES.has(entry.name))
        continue;
      const child = resolve(directory, entry.name);
      const pathFromRoot = relative(root.path, child);
      if (ignoredByGlob(pathFromRoot, globs)) continue;
      await walk(child, depth + 1);
    }
  }

  await walk(root.path, 0);
  return candidates;
}

async function canonicalizeCandidate(
  candidate: string,
  roots: readonly CanonicalRoot[],
  runner: CommandRunner,
  timeoutMs: number
): Promise<{ path: string; root: CanonicalRoot } | null> {
  const result = await runner(['git', 'rev-parse', '--show-toplevel'], {
    cwd: candidate,
    timeoutMs
  });
  if (result.timedOut) throw new Error(`Repository canonicalization timed out: ${candidate}`);
  if (result.exitCode !== 0) return null;
  const outputLines = result.stdout.trim().split(/\r?\n/);
  if (outputLines.length !== 1 || !isAbsolute(outputLines[0])) return null;

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(outputLines[0]);
  } catch {
    return null;
  }
  const root = roots.find(({ path }) => isContainedPath(path, canonicalPath));
  return root ? { path: canonicalPath, root } : null;
}

export async function discoverRepositories(
  options: DiscoveryOptions
): Promise<DiscoveredProject[]> {
  const maxDepth = options.maxDepth ?? 3;
  if (!Number.isInteger(maxDepth) || maxDepth < 0)
    throw new RangeError('Discovery depth must be a non-negative integer');
  const roots = await canonicalRoots(options.scanRoots);
  const globs = (options.ignoreGlobs ?? []).map((pattern) => new Bun.Glob(pattern));
  const runner = options.runner ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const candidates = (
    await Promise.all(roots.map((root) => walkRoot(root, maxDepth, globs)))
  ).flat();
  const repositories = new Map<string, DiscoveredProject>();

  for (const candidate of candidates) {
    const canonical = await canonicalizeCandidate(candidate, roots, runner, timeoutMs);
    if (!canonical || repositories.has(canonical.path)) continue;
    const relativePath = relative(canonical.root.path, canonical.path) || '.';
    repositories.set(canonical.path, {
      canonicalPath: canonical.path,
      relativePath,
      name: basename(canonical.path),
      scanRoot: canonical.root.path
    });
  }
  return [...repositories.values()].sort((left, right) =>
    left.canonicalPath.localeCompare(right.canonicalPath)
  );
}

/**
 * Whether a path is definitively gone.
 *
 * Only ENOENT counts. A permission or I/O error means the directory's fate is unknown, and
 * treating "cannot tell" as "deleted" would discard a project's notes and decisions over a
 * transient fault.
 */
export async function pathIsGone(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export interface VanishedProjectOptions {
  /** Only consider projects under these already-verified scan roots. */
  roots?: readonly string[];
  /** How long a project must have been missing before it may be forgotten. */
  graceMs?: number;
  now?: () => number;
}

/**
 * Projects that are eligible to be forgotten: gone from disk, and gone for long enough.
 *
 * Deliberately narrower than "was not discovered this scan". A project skipped because of an
 * ignore glob, a depth change, or an unreadable parent is still on disk, so each candidate is
 * stat'd directly and only a confirmed ENOENT counts.
 *
 * The grace period covers the cases a single stat cannot distinguish. A rename, a directory moved
 * aside for a day, or a detached volume all read as ENOENT — the volume case even for a project
 * whose own scan root is still present, because ENOENT is what an absent *ancestor* returns. A
 * project's note and decisions are worth more than the row, so absence has to persist before it
 * is believed.
 */
export async function findVanishedProjects(
  repository: CatalogRepository,
  options: VanishedProjectOptions = {}
): Promise<Project[]> {
  const now = (options.now ?? (() => Date.now()))();
  const graceMs = options.graceMs ?? 0;
  const scanned = options.roots ? new Set(options.roots) : null;
  const candidates = repository.listProjects({ includeHidden: true }).filter((project) => {
    if (!project.isMissing) return false;
    if (scanned && !scanned.has(resolve(project.scanRoot))) return false;
    if (graceMs <= 0) return true;
    // A row missing before this column existed has no start time; migration 004 stamps those, so
    // treat a null here as "only just noticed" rather than as instantly eligible.
    const since = project.missingSince ? Date.parse(project.missingSince) : Number.NaN;
    return Number.isFinite(since) && now - since >= graceMs;
  });
  const vanished: Project[] = [];
  for (const project of candidates)
    if (await pathIsGone(project.canonicalPath)) vanished.push(project);
  return vanished;
}

/** Removes catalog rows for projects that {@link findVanishedProjects} considers gone. */
async function forgetVanishedProjects(
  repository: CatalogRepository,
  options: VanishedProjectOptions & { lease?: ScanLeaseOwnership }
): Promise<Project[]> {
  const vanished = await findVanishedProjects(repository, options);
  const forgottenIds = new Set(
    await repository.forgetProjects(
      vanished.map(({ id }) => id),
      options.lease
    )
  );
  const forgotten = vanished.filter(({ id }) => forgottenIds.has(id));
  // Deleting a project destroys its note and decisions, so say which ones went and where from.
  for (const project of forgotten)
    console.warn(`Forgot missing project ${project.name} (${project.canonicalPath})`);
  return forgotten;
}

/** Marks missing rows only after the entire filesystem discovery has succeeded. */
export async function discoverAndReconcile(
  repository: CatalogRepository,
  options: DiscoveryOptions,
  lease?: ScanLeaseOwnership
): Promise<ReconciledDiscovery> {
  const discovered = await discoverRepositories(options);
  // realpath throws for a root that has gone away, aborting before anything is marked missing.
  const successfulRoots = await Promise.all(
    options.scanRoots.map((scanRoot) => realpath(resolve(scanRoot)))
  );
  const projects: Project[] = [];
  for (const project of discovered)
    projects.push(await repository.upsertDiscovered(project, lease));
  await repository.markUnseenMissing(
    successfulRoots,
    projects.map(({ id }) => id),
    lease
  );
  // Opt-in: a destructive default would make any future caller that forgets the flag delete rows.
  const forgotten =
    options.forgetMissing === true
      ? await forgetVanishedProjects(repository, {
          roots: successfulRoots,
          graceMs: options.forgetMissingAfterMs,
          lease
        })
      : [];
  return {
    projects,
    enrichmentProjects: projects.filter(({ isHidden }) => !isHidden),
    forgotten
  };
}
