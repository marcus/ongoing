import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { latestSchemaVersion, splitStatements } from '../../src/lib/server/catalog/migrations';
import { CatalogRepository, stableProjectId } from '../../src/lib/server/catalog/repository';
import {
  readDashboardCatalog,
  readHiddenCatalog,
  readHiddenProjects
} from '../../src/lib/dashboard/catalog';
import { readEntryViews } from '../../src/lib/server/catalog/entries';

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

function seedFixture(path: string, fixture: string): void {
  const database = new Database(path, { create: true });
  database.exec(readFileSync(`tests/fixtures/catalog/${fixture}.sql`, 'utf8'));
  database.close();
}

describe('catalog migrations', () => {
  it.each(['empty', 'v0', 'v2', 'v6'])(
    'migrates an %s database idempotently and transactionally',
    (fixture) => {
      const path = databasePath();
      if (fixture !== 'empty') seedFixture(path, fixture);

      const first = new CatalogDatabase(path);
      const applied = first.sqlite
        .query<{ version: number }, []>('SELECT version FROM schema_migrations ORDER BY version')
        .all();
      expect(applied.at(-1)).toEqual({ version: latestSchemaVersion });
      expect(
        first.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      ).toEqual(
        expect.arrayContaining([
          { name: 'entries' },
          { name: 'entry_sources' },
          { name: 'fields' },
          { name: 'relations' },
          { name: 'saved_views' },
          { name: 'project_metrics' },
          { name: 'metric_snapshots' },
          { name: 'collection_errors' },
          { name: 'scan_runs' },
          { name: 'project_stacks' },
          { name: 'toolchain_releases' },
          { name: 'toolchain_baseline_status' }
        ])
      );
      // The projects table is gone: its rows live in entries, its discovery columns in entry_sources.
      expect(
        first.sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
          .all()
      ).toEqual([]);
      expect(first.sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(first.sqlite.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(() =>
        first.sqlite
          .query(
            "INSERT INTO metric_snapshots (entry_id, metric, captured_on, value) VALUES ('missing', 'github_stars', '2026-01-01', 1)"
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

  it('rolls a migration back when any one of its statements fails', () => {
    // `Database.exec()` silently swallows a failing statement mid-script and keeps going, which
    // would let a rebuild drop a table after its copy failed. Statements run individually instead.
    const path = databasePath();
    const database = new Database(path, { create: true });
    database.exec('CREATE TABLE keep (x INTEGER PRIMARY KEY)');
    database.exec('INSERT INTO keep VALUES (1)');
    database.close();

    const reopened = new Database(path);
    expect(() =>
      reopened
        .transaction(() => {
          for (const statement of splitStatements(
            'INSERT INTO keep VALUES (2);\nINSERT INTO keep VALUES (1);\nDROP TABLE keep;'
          ))
            reopened.run(statement);
        })
        .immediate()
    ).toThrow(/UNIQUE/);
    expect(reopened.query('SELECT x FROM keep').all()).toEqual([{ x: 1 }]);
    reopened.close();
  });

  it('splits statements without breaking on comments or quoted literals', () => {
    expect(
      splitStatements(
        "-- leading comment; not a boundary\nCREATE TABLE t (\n  c TEXT CHECK (c IN ('a;b', 'c'))\n); -- trailing\nCREATE INDEX i ON t(c);\n"
      )
    ).toEqual([
      "CREATE TABLE t (\n  c TEXT CHECK (c IN ('a;b', 'c'))\n)",
      'CREATE INDEX i ON t(c)'
    ]);
  });

  it('moves a real projects catalog into entries without losing anything', () => {
    const path = databasePath();
    seedFixture(path, 'v6');
    const before = new Database(path);
    const projects = before
      .query<Record<string, string | number | null>, []>('SELECT * FROM projects ORDER BY id')
      .all();
    const counts = Object.fromEntries(
      ['project_metrics', 'metric_snapshots', 'project_stacks', 'collection_errors'].map(
        (table) => [
          table,
          Number(
            before.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()
              ?.count
          )
        ]
      )
    );
    before.close();

    const catalog = new CatalogDatabase(path);
    const repository = new CatalogRepository(catalog);

    // Every project is an entry, keyed by the same id, with a filesystem source and a slug.
    expect(repository.listEntries({ includeHidden: true }).map((entry) => entry.kind)).toEqual([
      'project',
      'project',
      'project'
    ]);
    const migrated = repository.listProjects({ includeHidden: true });
    expect(migrated.map(({ id }) => id).sort()).toEqual(projects.map((row) => String(row.id)));
    for (const row of projects) {
      const project = migrated.find(({ id }) => id === row.id);
      expect(project).toMatchObject({
        canonicalPath: row.canonical_path,
        relativePath: row.relative_path,
        name: row.name,
        scanRoot: row.scan_root,
        isFavorite: row.is_favorite === 1,
        isHidden: row.is_hidden === 1,
        manualRank: row.manual_rank,
        note: row.note,
        intent: row.intent,
        excitement: row.excitement,
        strategicImportance: row.strategic_importance,
        nextAction: row.next_action,
        reviewAfter: row.review_after,
        isMissing: row.is_missing === 1,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at
      });
      expect(project?.website?.slug ?? null).toEqual(
        row.website_json ? (JSON.parse(String(row.website_json)) as { slug: string }).slug : null
      );
    }

    // A project that was missing keeps when it went missing, so the forget grace period survives.
    const beta = migrated.find(({ id }) => id === 'project_beta');
    expect(beta?.missingSince).toBe('2026-01-06T00:00:00.000Z');
    // A row marked missing before migration 004 stamped it falls back to updated_at rather than
    // becoming instantly eligible to be forgotten.
    expect(migrated.find(({ id }) => id === 'project_gamma')?.missingSince).toBe(
      '2026-01-03T00:00:00.000Z'
    );

    // Slugs are generated and de-duplicated: two projects share the name "Ongoing Dashboard".
    expect(
      repository
        .listEntries({ includeHidden: true })
        .map((entry) => entry.slug)
        .sort()
    ).toEqual(['beta', 'ongoing-dashboard', 'ongoing-dashboard-2']);

    // Metric tables re-key to the entry id with their rows and shape intact.
    for (const [table, count] of Object.entries(counts))
      expect(
        catalog.sqlite.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()
          ?.count,
        table
      ).toBe(count);
    expect(repository.getMetrics('project_alpha')).toMatchObject({
      projectId: 'project_alpha',
      branch: 'main',
      commits30d: 42,
      locCode: 12000,
      githubStars: 7,
      tdOpenCount: 3,
      stackScannedAt: '2026-02-01T00:00:00.000Z'
    });
    expect(repository.listSnapshots('project_alpha')).toHaveLength(3);
    expect(repository.listProjectStacks('project_alpha').map(({ toolchain }) => toolchain)).toEqual(
      ['bun', 'go']
    );
    expect(repository.listCollectionErrors('project_alpha', true)).toHaveLength(1);
    expect(repository.listWebsitePages().map((page) => page.slug)).toEqual(['about']);
    expect(repository.getLatestScanRun()?.id).toBe('scan_1');
    expect(repository.listBaselineStatus().map(({ toolchain }) => toolchain)).toEqual(['go']);
    catalog.close();
  });

  it('preserves recorded collection errors while widening the collector constraint', () => {
    const path = databasePath();
    seedFixture(path, 'v2');
    const catalog = new CatalogDatabase(path);

    expect(catalog.sqlite.query('SELECT * FROM collection_errors').all()).toEqual([
      {
        entry_id: 'project_legacy',
        collector: 'git',
        message: 'git failed',
        occurred_at: '2026-01-02T00:00:00.000Z',
        resolved_at: null
      }
    ]);
    expect(() =>
      catalog.sqlite
        .query(
          "INSERT INTO collection_errors (entry_id, collector, message, occurred_at) VALUES ('project_legacy', 'stack', 'go.mod unreadable', '2026-01-03T00:00:00.000Z')"
        )
        .run()
    ).not.toThrow();
    expect(() =>
      catalog.sqlite
        .query(
          "INSERT INTO collection_errors (entry_id, collector, message, occurred_at) VALUES ('project_legacy', 'invented', 'nope', '2026-01-03T00:00:00.000Z')"
        )
        .run()
    ).toThrow();
    expect(
      catalog.sqlite
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .all('collection_errors_active')
    ).toEqual([{ name: 'collection_errors_active' }]);
    catalog.close();
  });
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

  it('replaces stack declarations wholesale so removed manifests stop reporting', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'stacked');

    await repository.replaceProjectStacks(project.id, [
      { toolchain: 'go', declared: '1.22', raw: '1.22', sourceFile: 'go.mod' },
      { toolchain: 'node', declared: '20', raw: '>=20', sourceFile: 'package.json' }
    ]);
    expect(repository.listProjectStacks(project.id)).toEqual([
      { toolchain: 'go', declared: '1.22', raw: '1.22', sourceFile: 'go.mod' },
      { toolchain: 'node', declared: '20', raw: '>=20', sourceFile: 'package.json' }
    ]);

    await repository.replaceProjectStacks(project.id, [
      { toolchain: 'go', declared: '1.24', raw: '1.24', sourceFile: 'go.mod' }
    ]);
    expect(repository.listProjectStacks(project.id)).toEqual([
      { toolchain: 'go', declared: '1.24', raw: '1.24', sourceFile: 'go.mod' }
    ]);
    expect([...repository.listAllProjectStacks().keys()]).toEqual([project.id]);
    catalog.close();
  });

  it('keeps cached release cycles when a baseline refresh fails', async () => {
    const { catalog, repository } = openRepository();
    const cycle = {
      toolchain: 'go' as const,
      cycle: '1.25',
      latest: '1.25.12',
      releaseDate: '2025-08-12',
      eolFrom: null,
      isEol: false,
      isMaintained: true,
      isLts: false,
      fetchedAt: '2026-07-29T00:00:00.000Z'
    };
    await repository.replaceToolchainReleases(
      {
        toolchain: 'go',
        availability: 'available',
        fetchedAt: '2026-07-29T00:00:00.000Z',
        message: null
      },
      [cycle]
    );
    expect(repository.listToolchainReleases().get('go')).toEqual([cycle]);

    await repository.replaceToolchainReleases(
      {
        toolchain: 'go',
        availability: 'unavailable',
        fetchedAt: '2026-07-30T00:00:00.000Z',
        message: 'network unreachable'
      },
      []
    );
    expect(repository.listToolchainReleases().get('go')).toEqual([cycle]);
    expect(repository.listBaselineStatus()).toEqual([
      {
        toolchain: 'go',
        availability: 'unavailable',
        fetchedAt: '2026-07-30T00:00:00.000Z',
        message: 'network unreachable'
      }
    ]);
    catalog.close();
  });

  it('forgets a project and everything keyed to it', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'doomed');
    const survivor = await addProject(repository, 'survivor');
    await repository.updateMetrics(project.id, { headSha: 'abc', locCode: 10 });
    await repository.saveSnapshot({
      projectId: project.id,
      metric: 'github_stars',
      capturedOn: '2026-01-01',
      value: 4
    });
    await repository.recordCollectionError({
      projectId: project.id,
      collector: 'hosting',
      message: 'boom',
      occurredAt: '2026-01-01T00:00:00Z'
    });

    await repository.forgetProject(project.id);

    expect(repository.getProject(project.id)).toBeNull();
    expect(repository.getMetrics(project.id)).toBeNull();
    expect(repository.listSnapshots(project.id)).toEqual([]);
    expect(repository.listCollectionErrors(project.id)).toEqual([]);
    const orphans = catalog.sqlite
      .query<{ count: number }, []>(
        `SELECT (SELECT COUNT(*) FROM project_metrics WHERE entry_id NOT IN (SELECT id FROM entries))
              + (SELECT COUNT(*) FROM metric_snapshots WHERE entry_id NOT IN (SELECT id FROM entries))
              + (SELECT COUNT(*) FROM collection_errors WHERE entry_id NOT IN (SELECT id FROM entries))
              + (SELECT COUNT(*) FROM project_stacks WHERE entry_id NOT IN (SELECT id FROM entries))
              + (SELECT COUNT(*) FROM entry_sources WHERE entry_id NOT IN (SELECT id FROM entries))
           AS count`
      )
      .get();
    expect(orphans?.count).toBe(0);
    expect(repository.getProject(survivor.id)).not.toBeNull();

    await expect(repository.forgetProject(project.id)).rejects.toThrow(/Unknown project ID/);
    expect(await repository.forgetProjects([project.id, survivor.id])).toEqual([survivor.id]);
    catalog.close();
  });

  it('drops late collector writes for a project forgotten mid-scan', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'racing');
    await repository.forgetProject(project.id);

    // A scan already in flight finishes its collectors and writes results for a row that is gone.
    // These must no-op: a foreign-key violation here escapes the scanner's own error handler and
    // fails the entire run.
    await expect(
      repository.recordCollectionError({
        projectId: project.id,
        collector: 'hosting',
        message: 'late',
        occurredAt: '2026-01-01T00:00:00Z'
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.saveSnapshot({
        projectId: project.id,
        metric: 'github_stars',
        capturedOn: '2026-01-01',
        value: 4
      })
    ).resolves.toBeUndefined();
    catalog.close();
  });

  it('reads the visible and hidden catalogs as complementary halves', async () => {
    const { catalog, repository } = openRepository();
    const visible = await addProject(repository, 'shown');
    const shelved = await addProject(repository, 'shelved');
    await repository.setHidden(shelved.id, true);

    const dashboard = readDashboardCatalog(repository);
    const hidden = readHiddenCatalog(repository);

    expect(dashboard.projects.map((project) => project.id)).toEqual([visible.id]);
    expect(hidden.projects.map((project) => project.id)).toEqual([shelved.id]);
    expect(dashboard).toMatchObject({ totalCount: 2, hiddenCount: 1 });
    expect(hidden).toMatchObject({ totalCount: 2, hiddenCount: 1 });
    expect(readHiddenProjects(repository).map((project) => project.id)).toEqual([shelved.id]);
    catalog.close();
  });
});

describe('entries, fields, relations, and views', () => {
  it('patches any registered field through one validated path', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'ongoing');

    const entry = repository.getEntry(project.id)!;
    expect(entry).toMatchObject({ kind: 'project', slug: 'ongoing', name: 'ongoing' });
    expect(repository.listSources(entry.id)).toEqual([
      expect.objectContaining({
        provider: 'filesystem',
        locator: '/code/ongoing',
        metadata: { relativePath: 'ongoing', scanRoot: '/code' },
        missingSince: null
      })
    ]);

    await repository.patchEntry(entry.id, {
      intent: 'invest',
      note: 'the dashboard',
      tags: ['Infra', 'infra'],
      is_favorite: true
    });
    const patched = repository.getEntry(entry.id)!;
    expect(patched.attributes.intent).toBe('invest');
    expect(patched.note).toBe('the dashboard');
    expect(patched.tags).toEqual(['infra']);
    expect(patched.isFavorite).toBe(true);
    // The project projection sees the same values, so the dashboard needs no second read model.
    expect(repository.getProject(entry.id)).toMatchObject({
      intent: 'invest',
      note: 'the dashboard',
      isFavorite: true,
      tags: ['infra']
    });

    await repository.patchEntry(entry.id, { intent: null });
    expect(repository.getEntry(entry.id)!.attributes).not.toHaveProperty('intent');
    await expect(repository.patchEntry(entry.id, { intent: 'invent' })).rejects.toThrow(
      /must be one of/
    );
    await expect(repository.patchEntry(entry.id, { 'github.stars': 5 })).rejects.toThrow(
      /read-only/
    );
    catalog.close();
  });

  it('registers a user field, stores values under it, and removes both together', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'ongoing');

    await repository.addUserField({ key: 'x.customer', type: 'text', label: 'Customer' });
    expect(repository.registry().get('x.customer')).toMatchObject({ owner: 'user' });
    await repository.patchEntry(project.id, { 'x.customer': 'acme' });
    expect(repository.getProject(project.id)?.attributes['x.customer']).toBe('acme');

    await repository.removeUserField('x.customer');
    expect(repository.registry().get('x.customer')).toBeUndefined();
    expect(repository.getEntry(project.id)!.attributes).not.toHaveProperty('x.customer');
    await expect(repository.removeUserField('x.customer')).rejects.toThrow(/Unknown user field/);
    catalog.close();
  });

  it('round-trips a declared relation between entries of the kinds it connects', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'ongoing');
    const technology = await repository.createEntry({
      kind: 'technology',
      name: 'SvelteKit',
      attributes: { ring: 'hot', technology_kind: 'framework' }
    });
    expect(technology).toMatchObject({ slug: 'sveltekit', kind: 'technology' });

    const relation = await repository.addRelation({
      fromId: project.id,
      toId: technology.id,
      kind: 'uses',
      note: 'the app is a SvelteKit app'
    });
    expect(relation).toMatchObject({ kind: 'uses', evidence: 'declared', provider: null });
    expect(repository.listRelations({ entryId: technology.id })).toHaveLength(1);
    // Re-declaring the same edge updates it rather than duplicating it.
    await repository.addRelation({ fromId: project.id, toId: technology.id, kind: 'uses' });
    expect(repository.listRelations()).toHaveLength(1);

    await expect(
      repository.addRelation({ fromId: technology.id, toId: project.id, kind: 'uses' })
    ).rejects.toThrow(/uses starts at project entries, not technology/);
    await expect(
      repository.addRelation({ fromId: project.id, toId: technology.id, kind: 'invented' })
    ).rejects.toThrow(/Unknown relation kind/);

    await repository.removeRelation(relation.id);
    expect(repository.listRelations()).toEqual([]);

    // Forgetting an entry takes its edges with it.
    const second = await repository.addRelation({
      fromId: project.id,
      toId: technology.id,
      kind: 'uses'
    });
    await repository.forgetProject(project.id);
    expect(repository.listRelations()).toEqual([]);
    expect(second.id).toBeTruthy();
    catalog.close();
  });

  it('saves, updates, and deletes a view by name', async () => {
    const { catalog, repository } = openRepository();
    const saved = await repository.saveView({
      name: 'oss-momentum',
      query: 'intent:invest github.stars>=100',
      columns: ['name', 'github.stars']
    });
    expect(saved).toMatchObject({ name: 'oss-momentum', position: 1 });
    const updated = await repository.saveView({ name: 'oss-momentum', query: 'tag:archived' });
    expect(updated.id).toBe(saved.id);
    expect(updated.query).toBe('tag:archived');
    expect(repository.listSavedViews()).toHaveLength(1);
    await repository.deleteSavedView('oss-momentum');
    expect(repository.listSavedViews()).toEqual([]);
    await expect(repository.deleteSavedView('oss-momentum')).rejects.toThrow(/Unknown saved view/);
    await expect(repository.saveView({ name: '' })).rejects.toThrow(/name is required/);
    catalog.close();
  });

  it('merges provider metrics into the read model as namespaced fields', async () => {
    const { catalog, repository } = openRepository();
    const project = await addProject(repository, 'ongoing');
    await repository.updateMetrics(project.id, { commits30d: 12, githubStars: 40 });
    await repository.replaceProjectStacks(project.id, [
      { toolchain: 'go', declared: '1.27', raw: 'go 1.27', sourceFile: 'go.mod' }
    ]);
    await repository.patchEntry(project.id, { intent: 'invest' });

    const [view] = readEntryViews(repository, { kind: 'project' });
    expect(view.fields).toMatchObject({
      name: 'ongoing',
      intent: 'invest',
      'git.commits30d': 12,
      'github.stars': 40,
      'stack.go': '1.27'
    });
    expect(view.sources[0].locator).toBe('/code/ongoing');
    catalog.close();
  });
});
