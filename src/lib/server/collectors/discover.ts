import { opendir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { DiscoveredProject, Project } from '$lib/domain/project';
import { CatalogRepository } from '$lib/server/catalog/repository';
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
}

export interface ReconciledDiscovery {
  projects: Project[];
  enrichmentProjects: Project[];
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

/** Marks missing rows only after the entire filesystem discovery has succeeded. */
export async function discoverAndReconcile(
  repository: CatalogRepository,
  options: DiscoveryOptions
): Promise<ReconciledDiscovery> {
  const discovered = await discoverRepositories(options);
  const successfulRoots = await Promise.all(
    options.scanRoots.map((scanRoot) => realpath(resolve(scanRoot)))
  );
  const projects: Project[] = [];
  for (const project of discovered) projects.push(await repository.upsertDiscovered(project));
  await repository.markUnseenMissing(
    successfulRoots,
    projects.map(({ id }) => id)
  );
  return { projects, enrichmentProjects: projects.filter(({ isHidden }) => !isHidden) };
}
