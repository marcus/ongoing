import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEntryViews } from '../../src/lib/server/catalog/entries';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';
import { discoverRemoteRepositories } from '../../src/lib/server/collectors/github-discovery';
import type { RemoteRepository } from '../../src/lib/server/github/discovery';

/**
 * Remote-only entries: a repository an owner has that nothing local claims is still part of the
 * inventory, and every surface has to say so honestly — no path, no local metrics.
 */
const directories: string[] = [];

function openRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'ongoing-remote-'));
  directories.push(directory);
  const catalog = new CatalogDatabase(join(directory, 'catalog.sqlite'));
  let tick = 0;
  return {
    catalog,
    repository: new CatalogRepository(catalog, () => `2026-01-01T00:00:0${tick++}Z`)
  };
}

function repo(name: string, overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    owner: 'acme',
    name,
    repositoryId: `R_${name}`,
    isArchived: false,
    isFork: false,
    visibility: 'public',
    description: null,
    ...overrides
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('remote repository discovery', () => {
  it('catalogues a repository with no local checkout and leaves it without a path', async () => {
    const { catalog, repository } = openRepository();
    const result = await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas'), repo('beacon')]
    });
    expect(result.created).toBe(2);

    const views = readEntryViews(repository).filter((entry) => entry.kind === 'project');
    expect(views.map((entry) => entry.slug).sort()).toEqual(['atlas', 'beacon']);
    for (const view of views) {
      expect(view.path).toBeNull();
      expect(view.fields.path).toBeUndefined();
      expect(view.fields.is_missing).toBeUndefined();
      expect(view.metrics).toBeNull();
      expect(view.sources.map(({ provider, locator }) => `${provider}:${locator}`)).toEqual([
        `github:acme/${view.slug}`
      ]);
    }
    // No filesystem source means no path to open, scan, or forget, so the project projection —
    // what `ongoing show` reads — does not carry it.
    expect(repository.listProjects()).toEqual([]);
    catalog.close();
  });

  it('is idempotent, and keeps ids stable so notes and rank survive a rescan', async () => {
    const { catalog, repository } = openRepository();
    await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas')]
    });
    const [before] = repository.listRemoteProjects('github');
    await repository.patchEntry(before.entry.id, { intent: 'maintain' });

    const second = await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas')]
    });
    expect(second.created).toBe(0);
    const [after] = repository.listRemoteProjects('github');
    expect(after.entry.id).toBe(before.entry.id);
    expect(after.entry.attributes.intent).toBe('maintain');
    catalog.close();
  });

  it('skips forks and archived repositories unless asked for them', async () => {
    const { catalog, repository } = openRepository();
    const listing = [
      repo('atlas'),
      repo('forked', { isFork: true }),
      repo('old', { isArchived: true })
    ];
    await discoverRemoteRepositories(repository, { owners: ['acme'], list: async () => listing });
    expect(repository.listRemoteProjects('github').map(({ locator }) => locator)).toEqual([
      'acme/atlas'
    ]);

    await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => listing,
      includeForks: true,
      includeArchived: true
    });
    expect(repository.listRemoteProjects('github').map(({ locator }) => locator)).toEqual([
      'acme/atlas',
      'acme/forked',
      'acme/old'
    ]);
    catalog.close();
  });

  it('does not duplicate a repository a local checkout already claims', async () => {
    const { catalog, repository } = openRepository();
    const local = await repository.upsertDiscovered({
      canonicalPath: '/code/atlas',
      relativePath: 'atlas',
      name: 'atlas',
      scanRoot: '/code'
    });
    await repository.updateMetrics(local.id, { githubOwner: 'acme', githubName: 'atlas' });

    const result = await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas')]
    });
    expect(result.created).toBe(0);
    expect(repository.listRemoteProjects('github')).toEqual([]);
    catalog.close();
  });

  it('drops what it owns when the repository is gone, and keeps what a person wrote on', async () => {
    const { catalog, repository } = openRepository();
    await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas'), repo('beacon')]
    });
    const annotated = repository
      .listRemoteProjects('github')
      .find(({ locator }) => locator === 'acme/beacon')!;
    await repository.patchEntry(annotated.entry.id, { note: 'worth a look' });

    const result = await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => []
    });
    expect(result).toMatchObject({ created: 0, removed: 1, kept: 1 });
    expect(repository.listRemoteProjects('github').map(({ locator }) => locator)).toEqual([
      'acme/beacon'
    ]);
    catalog.close();
  });

  it('removes nothing when an owner’s listing failed', async () => {
    const { catalog, repository } = openRepository();
    await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => [repo('atlas')]
    });
    const result = await discoverRemoteRepositories(repository, {
      owners: ['acme'],
      list: async () => {
        throw new Error('GitHub authentication is required');
      }
    });
    expect(result.removed).toBe(0);
    expect(result.failures).toEqual([
      { owner: 'acme', message: 'GitHub authentication is required' }
    ]);
    expect(repository.listRemoteProjects('github')).toHaveLength(1);
    catalog.close();
  });

  it('does nothing at all when no owner is configured', async () => {
    const { catalog, repository } = openRepository();
    let called = false;
    const result = await discoverRemoteRepositories(repository, {
      owners: [],
      list: async () => {
        called = true;
        return [];
      }
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ created: 0, removed: 0 });
    catalog.close();
  });
});
