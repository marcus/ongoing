import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { latestSchemaVersion } from '../../src/lib/server/catalog/migrations';
import { CatalogRepository, stableProjectId } from '../../src/lib/server/catalog/repository';

const temporaryDirectories: string[] = [];

function databasePath(name = 'catalog.sqlite'): string {
  const directory = mkdtempSync(join(tmpdir(), 'ongoing-catalog-'));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

function openRepository(path = databasePath()) {
  const catalog = new CatalogDatabase(path);
  let tick = 0;
  const repository = new CatalogRepository(catalog, () => `2026-01-01T00:00:0${tick++}Z`);
  return { catalog, repository };
}

async function addProject(repository: CatalogRepository, name: string) {
  return repository.upsertDiscovered({
    canonicalPath: `/code/${name}`,
    relativePath: name,
    name,
    scanRoot: '/code'
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('catalog migrations', () => {
  it.each(['empty', 'v0'])(
    'migrates an %s database idempotently and transactionally',
    (fixture) => {
      const path = databasePath();
      if (fixture === 'v0') {
        const database = new Database(path, { create: true });
        database.exec(readFileSync('tests/fixtures/catalog/v0.sql', 'utf8'));
        database.close();
      }

      const first = new CatalogDatabase(path);
      const applied = first.sqlite
        .query<{ version: number }, []>('SELECT version FROM schema_migrations ORDER BY version')
        .all();
      expect(applied.at(-1)).toEqual({ version: latestSchemaVersion });
      expect(
        first.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      ).toEqual(
        expect.arrayContaining([
          { name: 'projects' },
          { name: 'project_metrics' },
          { name: 'metric_snapshots' },
          { name: 'collection_errors' },
          { name: 'scan_runs' }
        ])
      );
      expect(first.sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(first.sqlite.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(() =>
        first.sqlite
          .query(
            "INSERT INTO metric_snapshots (project_id, metric, captured_on, value) VALUES ('missing', 'github_stars', '2026-01-01', 1)"
          )
          .run()
      ).toThrow();
      first.close();

      const reopened = new CatalogDatabase(path);
      expect(
        reopened.sqlite.query('SELECT COUNT(*) AS count FROM schema_migrations').get()
      ).toEqual({ count: latestSchemaVersion });
      reopened.close();
    }
  );
});

describe('catalog repository', () => {
  it('persists annotations and decision state while rediscovery preserves local state', async () => {
    const path = databasePath();
    const { catalog, repository } = openRepository(path);
    const project = await addProject(repository, 'café project');
    expect(project.id).toBe(stableProjectId('/code/café project'));

    await repository.setFavorite(project.id, true);
    await repository.updateNote(project.id, "don't forget the release");
    await repository.updateDecision(project.id, {
      intent: 'invest',
      excitement: 5,
      strategicImportance: 4,
      nextAction: 'ship it',
      reviewAfter: '2026-08-01'
    });
    await repository.setHidden(project.id, true);
    await repository.setMissing(project.id, true);
    await addProject(repository, 'café project');

    expect(repository.getProject(project.id)).toMatchObject({
      isFavorite: true,
      isHidden: true,
      isMissing: false,
      note: "don't forget the release",
      intent: 'invest',
      excitement: 5,
      strategicImportance: 4,
      nextAction: 'ship it',
      reviewAfter: '2026-08-01'
    });
    expect(repository.listProjects()).toEqual([]);
    await repository.setHidden(project.id, false);
    expect(repository.listProjects()).toHaveLength(1);

    await expect(repository.updateNote(project.id, 'x'.repeat(501))).rejects.toThrow(/500/);
    await expect(repository.updateDecision(project.id, { excitement: 6 })).rejects.toThrow(
      /1 through 5/
    );
    expect(() =>
      catalog.sqlite
        .query('UPDATE projects SET note = ? WHERE id = ?')
        .run('x'.repeat(501), project.id)
    ).toThrow();
    catalog.close();

    const reopened = openRepository(path);
    expect(reopened.repository.getProject(project.id)?.note).toBe("don't forget the release");
    reopened.catalog.close();
  });

  it('rewrites a complete visible sequence transactionally and preserves hidden ranks', async () => {
    const { catalog, repository } = openRepository();
    const alpha = await addProject(repository, 'alpha');
    const beta = await addProject(repository, 'beta');
    const hidden = await addProject(repository, 'hidden');
    await repository.setHidden(hidden.id, true);
    const hiddenRank = repository.getProject(hidden.id)?.manualRank;

    await repository.reorderVisibleProjects([beta.id, alpha.id]);
    expect(repository.listProjects().map(({ id, manualRank }) => [id, manualRank])).toEqual([
      [beta.id, 1_000],
      [alpha.id, 2_000]
    ]);
    expect(repository.getProject(hidden.id)?.manualRank).toBe(hiddenRank);

    const before = repository.listProjects().map(({ id, manualRank }) => [id, manualRank]);
    await expect(repository.reorderVisibleProjects([alpha.id, alpha.id])).rejects.toThrow(
      /duplicate/
    );
    await expect(repository.reorderVisibleProjects([alpha.id, 'unknown'])).rejects.toThrow(
      /unknown/
    );
    await expect(repository.reorderVisibleProjects([alpha.id])).rejects.toThrow(/every visible/);
    expect(repository.listProjects().map(({ id, manualRank }) => [id, manualRank])).toEqual(before);
    catalog.close();
  });

  it('marks unseen projects missing without changing hidden state and clears missing on discovery', async () => {
    const { catalog, repository } = openRepository();
    const seen = await addProject(repository, 'seen');
    const gone = await addProject(repository, 'gone');
    await repository.setHidden(gone.id, true);
    await repository.markUnseenMissing(['/code'], [seen.id]);
    expect(repository.getProject(seen.id)?.isMissing).toBe(false);
    expect(repository.getProject(gone.id)).toMatchObject({ isMissing: true, isHidden: true });
    await addProject(repository, 'gone');
    expect(repository.getProject(gone.id)).toMatchObject({ isMissing: false, isHidden: true });
    catalog.close();
  });

  it('stores normalized metrics, snapshots, collection errors, and scan runs', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'metrics');
    await repository.updateMetrics(project.id, {
      headSha: 'abc',
      commits7d: 2,
      commits30d: 4,
      commits90d: 8,
      activeDays90d: 6,
      churnAdded90d: 100,
      contributorCount: 3,
      localAuthorCommitShare30d: 0.75,
      latestTag: 'v1.0.0',
      locFiles: 20,
      locTest: 200,
      tdInProgressCount: 2,
      tdTotalNonClosedCount: 5,
      githubRepoId: 'R_1',
      githubVisibility: 'private',
      githubIsArchived: false,
      githubReadyPrs: 2,
      githubMergedPrs90d: 4,
      githubExternalIssues90d: 3,
      githubLatestReleaseTag: 'v1.0.0',
      githubReleaseDownloads: 12,
      githubTrafficViews: 50,
      githubTrafficUniqueCloners: 4,
      githubAvailability: 'available',
      githubTrafficAvailability: 'unavailable',
      githubTrafficScannedAt: '2026-01-01T00:00:00Z'
    });
    expect(repository.getMetrics(project.id)).toMatchObject({
      commits7d: 2,
      commits90d: 8,
      localAuthorCommitShare30d: 0.75,
      githubIsArchived: false,
      githubTrafficViews: 50,
      githubTrafficAvailability: 'unavailable'
    });

    await repository.saveSnapshot({
      projectId: project.id,
      metric: 'github_stars',
      capturedOn: '2026-01-01',
      value: 4
    });
    await repository.saveSnapshot({
      projectId: project.id,
      metric: 'github_stars',
      capturedOn: '2026-01-01',
      value: 5
    });
    expect(repository.listSnapshots(project.id, 'github_stars')).toEqual([
      { projectId: project.id, metric: 'github_stars', capturedOn: '2026-01-01', value: 5 }
    ]);

    await repository.recordCollectionError({
      projectId: project.id,
      collector: 'hosting',
      message: 'credentials unavailable',
      occurredAt: '2026-01-01T00:00:00Z'
    });
    expect(repository.listCollectionErrors(project.id, true)).toHaveLength(1);
    await repository.resolveCollectionError(project.id, 'hosting', '2026-01-02T00:00:00Z');
    expect(repository.listCollectionErrors(project.id, true)).toEqual([]);

    await repository.createScanRun({
      id: 'scan-1',
      reason: 'manual',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: null,
      discoveredCount: 0,
      updatedCount: 0,
      errorCount: 0
    });
    await repository.finishScanRun(
      'scan-1',
      'completed',
      {
        discoveredCount: 1,
        updatedCount: 1,
        errorCount: 0
      },
      '2026-01-01T00:01:00Z'
    );
    expect(repository.getScanRun('scan-1')).toMatchObject({
      status: 'completed',
      discoveredCount: 1,
      updatedCount: 1,
      errorCount: 0
    });
    await expect(
      repository.finishScanRun('scan-1', 'failed', {
        discoveredCount: 0,
        updatedCount: 0,
        errorCount: 1
      })
    ).rejects.toThrow(/already finished/);
    catalog.close();
  });

  it('serializes parameterized writes', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'serialized');
    await Promise.all([
      repository.updateNote(project.id, 'first'),
      repository.updateNote(project.id, 'second'),
      repository.updateNote(project.id, 'third')
    ]);
    expect(repository.getProject(project.id)?.note).toBe('third');
    catalog.close();
  });
});
