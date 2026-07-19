import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';

const path = resolve(process.env.DATABASE_PATH ?? '.data/ongoing-e2e.sqlite');
rmSync(path, { force: true });
rmSync(`${path}-shm`, { force: true });
rmSync(`${path}-wal`, { force: true });

const catalog = new CatalogDatabase(path);
const repository = new CatalogRepository(catalog, () => '2026-07-19T12:00:00.000Z');

const alpha = await repository.upsertDiscovered({
  canonicalPath: '/code/alpha',
  relativePath: 'alpha',
  name: 'alpha',
  scanRoot: '/code'
});
await repository.setFavorite(alpha.id, true);
await repository.updateNote(alpha.id, 'release after parser cleanup');
await repository.updateMetrics(alpha.id, {
  branch: 'main',
  headSha: 'a3f19c2',
  latestCommitShortSha: 'a3f19c2',
  latestCommitAt: '2026-07-19T10:00:00.000Z',
  latestCommitSubject: 'Tighten parser',
  commitCount: 140,
  commits7d: 8,
  commits30d: 18,
  commits90d: 31,
  activeDays30d: 9,
  dirtyFiles: 2,
  aheadCount: 1,
  behindCount: 0,
  locCode: 4_812,
  dominantLanguage: 'TypeScript',
  tdOpenCount: 2,
  tdInProgressCount: 1,
  tdTotalNonClosedCount: 4,
  tdBlockedCount: 1,
  tdReviewCount: 1,
  tdStaleCount: 1,
  githubRepoId: 'R_alpha',
  githubOwner: 'example',
  githubName: 'alpha',
  githubStars: 120,
  githubOpenIssues: 3,
  githubOpenPrs: 2,
  githubExternalPrs: 1,
  githubCiState: 'success',
  gitScannedAt: '2026-07-19T11:59:00.000Z',
  tdScannedAt: '2026-07-19T11:59:00.000Z'
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_stars',
  capturedOn: '2026-06-18',
  value: 110
});

const beta = await repository.upsertDiscovered({
  canonicalPath: '/code/beta',
  relativePath: 'beta',
  name: 'beta',
  scanRoot: '/code'
});
await repository.updateMetrics(beta.id, {
  branch: 'feat/catalog',
  latestCommitAt: '2026-07-18T12:00:00.000Z',
  latestCommitSubject: 'Build catalog',
  commitCount: 420,
  commits7d: 3,
  commits30d: 7,
  commits90d: 20,
  activeDays30d: 4,
  locCode: 18_200,
  dominantLanguage: 'Go',
  tdTotalNonClosedCount: 2,
  gitScannedAt: '2026-07-19T11:59:00.000Z'
});
await repository.recordCollectionError({
  projectId: beta.id,
  collector: 'hosting',
  message: 'GitHub credentials unavailable',
  occurredAt: '2026-07-19T11:58:00.000Z'
});

await repository.createScanRun({
  id: 'scan-e2e',
  reason: 'cli',
  status: 'running',
  startedAt: '2026-07-19T11:55:00.000Z',
  finishedAt: null,
  discoveredCount: 2,
  updatedCount: 2,
  errorCount: 1
});
await repository.finishScanRun(
  'scan-e2e',
  'completed',
  { discoveredCount: 2, updatedCount: 2, errorCount: 1 },
  '2026-07-19T12:00:00.000Z'
);
catalog.close();
