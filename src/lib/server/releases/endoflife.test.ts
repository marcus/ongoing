import { describe, expect, it, vi } from 'vitest';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { refreshReleaseBaselines } from './baseline';
import {
  EndOfLifeProvider,
  parseReleaseDocument,
  releaseProductId,
  ReleaseBaselineError,
  type ReleaseBaselineProvider
} from './endoflife';

const GO_DOCUMENT = {
  schema_version: '1.2.1',
  result: {
    releases: [
      {
        name: '1.25',
        label: '1.25',
        releaseDate: '2025-08-12',
        isLts: false,
        isEol: false,
        eolFrom: null,
        isMaintained: true,
        latest: { name: '1.25.12', date: '2026-07-07' }
      },
      {
        name: '1.23',
        label: '1.23',
        releaseDate: '2024-08-13',
        isLts: false,
        isEol: true,
        eolFrom: '2026-02-11',
        isMaintained: false,
        latest: { name: '1.23.12', date: '2026-02-04' }
      }
    ]
  }
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function repository() {
  const catalog = new CatalogDatabase(':memory:');
  return { catalog, repository: new CatalogRepository(catalog, () => '2026-07-30T00:00:00.000Z') };
}

async function withStack(
  repo: CatalogRepository,
  name: string,
  toolchain: 'go' | 'node' | 'swift'
) {
  const project = await repo.upsertDiscovered({
    canonicalPath: `/code/${name}`,
    relativePath: name,
    name,
    scanRoot: '/code'
  });
  await repo.replaceProjectStacks(project.id, [
    { toolchain, declared: '1.0', raw: '1.0', sourceFile: 'manifest' }
  ]);
  return project;
}

describe('endoflife.date provider', () => {
  it('maps toolchains onto product identifiers, leaving untracked ones unresolved', () => {
    expect(releaseProductId('go')).toBe('go');
    expect(releaseProductId('node')).toBe('nodejs');
    expect(releaseProductId('java')).toBeNull();
    expect(releaseProductId('swift')).toBeNull();
  });

  it('parses the v1 product document into release cycles', () => {
    expect(parseReleaseDocument('go', GO_DOCUMENT)).toEqual([
      {
        toolchain: 'go',
        cycle: '1.25',
        latest: '1.25.12',
        releaseDate: '2025-08-12',
        eolFrom: null,
        isEol: false,
        isMaintained: true,
        isLts: false
      },
      {
        toolchain: 'go',
        cycle: '1.23',
        latest: '1.23.12',
        releaseDate: '2024-08-13',
        eolFrom: '2026-02-11',
        isEol: true,
        isMaintained: false,
        isLts: false
      }
    ]);
  });

  it('rejects documents it cannot use rather than caching an empty baseline', () => {
    expect(() => parseReleaseDocument('go', { result: {} })).toThrow(/unexpected document/);
    expect(() => parseReleaseDocument('go', { result: { releases: [] } })).toThrow(/no usable/);
  });

  it('requests the product endpoint and surfaces rate limiting distinctly', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(GO_DOCUMENT));
    const provider = new EndOfLifeProvider({
      apiUrl: 'https://example.test/api/v1/',
      fetch: fetcher
    });
    expect(await provider.fetchCycles('go')).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/v1/products/go/',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );

    const limited = new EndOfLifeProvider({
      fetch: async () => new Response('', { status: 429 })
    });
    await expect(limited.fetchCycles('go')).rejects.toMatchObject({
      availability: 'rate_limited'
    });

    const broken = new EndOfLifeProvider({
      fetch: async () => {
        throw new Error('network unreachable');
      }
    });
    await expect(broken.fetchCycles('go')).rejects.toThrow(/network unreachable/);
  });
});

describe('baseline refresh', () => {
  it('fetches only declared, tracked toolchains and caches the result', async () => {
    const { catalog, repository: repo } = repository();
    await withStack(repo, 'api', 'go');
    await withStack(repo, 'web', 'swift');
    const provider: ReleaseBaselineProvider = {
      fetchCycles: vi.fn().mockResolvedValue(parseReleaseDocument('go', GO_DOCUMENT))
    };

    const result = await refreshReleaseBaselines(repo, {
      provider,
      maxAgeHours: 24,
      now: () => '2026-07-30T00:00:00.000Z'
    });

    expect(result).toMatchObject({ refreshed: ['go'], failed: [], skipped: [] });
    expect(provider.fetchCycles).toHaveBeenCalledTimes(1);
    expect(repo.listToolchainReleases().get('go')).toHaveLength(2);
    catalog.close();
  });

  it('skips a fresh baseline and refreshes once it ages past the window', async () => {
    const { catalog, repository: repo } = repository();
    await withStack(repo, 'api', 'go');
    const provider: ReleaseBaselineProvider = {
      fetchCycles: vi.fn().mockResolvedValue(parseReleaseDocument('go', GO_DOCUMENT))
    };
    const refresh = (now: string, force = false) =>
      refreshReleaseBaselines(repo, { provider, maxAgeHours: 24, force, now: () => now });

    await refresh('2026-07-30T00:00:00.000Z');
    expect(await refresh('2026-07-30T12:00:00.000Z')).toMatchObject({ skipped: ['go'] });
    expect(await refresh('2026-07-31T00:00:00.000Z')).toMatchObject({ refreshed: ['go'] });
    expect(await refresh('2026-07-31T00:00:01.000Z', true)).toMatchObject({ refreshed: ['go'] });
    catalog.close();
  });

  it('preserves cached cycles when a refresh fails and retries sooner than a success', async () => {
    const { catalog, repository: repo } = repository();
    await withStack(repo, 'api', 'go');
    const cycles = parseReleaseDocument('go', GO_DOCUMENT);
    const fetchCycles = vi
      .fn()
      .mockResolvedValueOnce(cycles)
      .mockRejectedValue(new ReleaseBaselineError('network unreachable'));
    const provider: ReleaseBaselineProvider = { fetchCycles };
    const refresh = (now: string) =>
      refreshReleaseBaselines(repo, { provider, maxAgeHours: 24, now: () => now });

    await refresh('2026-07-30T00:00:00.000Z');
    expect(await refresh('2026-07-31T00:00:00.000Z')).toMatchObject({ failed: ['go'] });

    expect(repo.listToolchainReleases().get('go')).toHaveLength(2);
    expect(repo.listBaselineStatus()).toEqual([
      {
        toolchain: 'go',
        availability: 'unavailable',
        fetchedAt: '2026-07-31T00:00:00.000Z',
        message: 'network unreachable'
      }
    ]);
    // A failure backs off for an hour rather than the full success window.
    expect(await refresh('2026-07-31T00:30:00.000Z')).toMatchObject({ skipped: ['go'] });
    expect(await refresh('2026-07-31T01:00:00.000Z')).toMatchObject({ failed: ['go'] });
    catalog.close();
  });
});
