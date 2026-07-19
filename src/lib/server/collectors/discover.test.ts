import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { discoverAndReconcile, discoverRepositories, isPathWithinRoots } from './discover';
import { runSuccessfulCommand } from './process';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function initRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await runSuccessfulCommand(['git', 'init', '-b', 'main'], { cwd: path, timeoutMs: 2_000 });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('repository discovery', () => {
  it('finds normal, Unicode/space, and linked-worktree repositories and deduplicates roots', async () => {
    const root = await temporaryDirectory('ongoing-discovery-');
    const normal = join(root, 'normal');
    const unicode = join(root, 'group', 'café project');
    const worktree = join(root, 'linked worktree');
    await initRepository(normal);
    await initRepository(unicode);
    await writeFile(join(normal, 'file.txt'), 'one');
    await runSuccessfulCommand(['git', 'add', 'file.txt'], { cwd: normal, timeoutMs: 2_000 });
    await runSuccessfulCommand(
      [
        'git',
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'initial'
      ],
      { cwd: normal, timeoutMs: 2_000 }
    );
    await runSuccessfulCommand(['git', 'worktree', 'add', '-b', 'linked', worktree], {
      cwd: normal,
      timeoutMs: 2_000
    });

    const projects = await discoverRepositories({
      scanRoots: [root, join(root, 'group')],
      maxDepth: 3
    });
    const expectedPaths = await Promise.all(
      [normal, unicode, worktree].map((path) => realpath(path))
    );
    expect(projects.map(({ canonicalPath }) => canonicalPath)).toEqual(
      expectedPaths.sort((a, b) => a.localeCompare(b))
    );
    const canonicalUnicode = await realpath(unicode);
    expect(projects.find(({ canonicalPath }) => canonicalPath === canonicalUnicode)).toMatchObject({
      name: 'café project'
    });
  });

  it('honors depth, configured ignores, expensive-directory pruning, and symlink boundaries', async () => {
    const root = await temporaryDirectory('ongoing-bounds-');
    const outside = await temporaryDirectory('ongoing-outside-');
    const depth3 = join(root, 'one', 'two', 'three');
    const depth4 = join(depth3, 'four');
    const ignored = join(root, 'area', 'ignored', 'repo');
    const packageStore = join(root, 'node_modules', 'package');
    await Promise.all([
      initRepository(depth3),
      initRepository(depth4),
      initRepository(ignored),
      initRepository(packageStore),
      initRepository(join(outside, 'escape'))
    ]);
    await symlink(join(outside, 'escape'), join(root, 'escape-link'), 'dir');

    const projects = await discoverRepositories({
      scanRoots: [root],
      maxDepth: 3,
      ignoreGlobs: ['**/ignored/**']
    });
    expect(projects.map(({ canonicalPath }) => canonicalPath)).toEqual([await realpath(depth3)]);
    expect(isPathWithinRoots(join(root, 'safe'), [root])).toBe(true);
    expect(isPathWithinRoots(join(root, '..', 'outside'), [root])).toBe(false);
  });

  it('skips malformed canonicalization output and rejects root escapes', async () => {
    const root = await temporaryDirectory('ongoing-malformed-');
    await initRepository(join(root, 'candidate'));
    const malformed = await discoverRepositories({
      scanRoots: [root],
      runner: async (command, options) => ({
        command,
        cwd: options.cwd,
        exitCode: 0,
        stdout: 'relative/path\nextra\n',
        stderr: '',
        timedOut: false
      })
    });
    expect(malformed).toEqual([]);

    const escaped = await discoverRepositories({
      scanRoots: [root],
      runner: async (command, options) => ({
        command,
        cwd: options.cwd,
        exitCode: 0,
        stdout: `${resolve(root, '..')}\n`,
        stderr: '',
        timedOut: false
      })
    });
    expect(escaped).toEqual([]);
  });

  it('marks missing only after successful discovery and returns hidden projects for discovery only', async () => {
    const root = await temporaryDirectory('ongoing-reconcile-');
    const databasePath = join(await temporaryDirectory('ongoing-db-'), 'catalog.sqlite');
    const catalog = new CatalogDatabase(databasePath);
    const repository = new CatalogRepository(catalog);
    const existingPath = join(root, 'existing');
    await initRepository(existingPath);
    const canonicalExistingPath = await realpath(existingPath);
    const canonicalRoot = await realpath(root);
    const existing = await repository.upsertDiscovered({
      canonicalPath: canonicalExistingPath,
      relativePath: 'existing',
      name: 'existing',
      scanRoot: canonicalRoot
    });
    await repository.setHidden(existing.id, true);

    await expect(
      discoverAndReconcile(repository, { scanRoots: [join(root, 'missing')] })
    ).rejects.toThrow();
    expect(repository.getProject(existing.id)?.isMissing).toBe(false);

    await expect(
      discoverAndReconcile(repository, {
        scanRoots: [root],
        runner: async (command, options) => ({
          command,
          cwd: options.cwd,
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: true
        })
      })
    ).rejects.toThrow(/timed out/);
    expect(repository.getProject(existing.id)?.isMissing).toBe(false);

    const first = await discoverAndReconcile(repository, { scanRoots: [root] });
    expect(first.projects).toHaveLength(1);
    expect(first.enrichmentProjects).toEqual([]);
    await rm(existingPath, { recursive: true, force: true });
    const second = await discoverAndReconcile(repository, { scanRoots: [root] });
    expect(second.projects).toEqual([]);
    expect(repository.getProject(existing.id)).toMatchObject({ isMissing: true, isHidden: true });
    catalog.close();
  });
});
