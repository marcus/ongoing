import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { runProjectAction } from './actions';

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
);

describe('local project actions', () => {
  it('resolves a validated database ID to a contained canonical path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ongoing-actions-'));
    directories.push(root);
    const projectPath = join(root, 'project');
    mkdirSync(projectPath);
    const catalog = new CatalogDatabase(':memory:');
    const repository = new CatalogRepository(catalog);
    const project = await repository.upsertDiscovered({
      canonicalPath: projectPath,
      relativePath: 'project',
      name: 'project',
      scanRoot: realpathSync(root)
    });
    const commands: readonly string[][] = [];
    await runProjectAction(repository, project.id, 'terminal', {
      platform: 'darwin',
      runner: async (command) => {
        (commands as string[][]).push([...command]);
      }
    });
    expect(commands).toEqual([['open', '-a', 'Terminal', realpathSync(projectPath)]]);
    await expect(
      runProjectAction(repository, '../../etc', 'finder', { runner: async () => undefined })
    ).rejects.toThrow(/Unknown project ID/);
    catalog.close();
  });

  it('rejects a stored project path that escapes its validated scan root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ongoing-actions-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'ongoing-actions-outside-'));
    directories.push(root, outside);
    const catalog = new CatalogDatabase(':memory:');
    const repository = new CatalogRepository(catalog);
    const project = await repository.upsertDiscovered({
      canonicalPath: outside,
      relativePath: 'outside',
      name: 'outside',
      scanRoot: realpathSync(root)
    });
    await expect(
      runProjectAction(repository, project.id, 'finder', { runner: async () => undefined })
    ).rejects.toThrow(/outside its validated scan root/);
    catalog.close();
  });
});
