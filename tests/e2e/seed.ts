import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';

const path = resolve(process.env.DATABASE_PATH ?? '.data/ongoing-e2e.sqlite');
const scanRoot = resolve(process.env.SCAN_ROOTS ?? '/private/tmp/ongoing-e2e-unscanned');
mkdirSync(scanRoot, { recursive: true });
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
  githubForks: 14,
  githubWatchers: 9,
  githubVisibility: 'public',
  githubIsArchived: false,
  githubOpenIssues: 3,
  githubOpenPrs: 2,
  githubDraftPrs: 1,
  githubReadyPrs: 1,
  githubOwnerPrs: 1,
  githubExternalPrs: 1,
  githubOldestExternalPrAt: '2026-06-12T10:00:00.000Z',
  githubMergedPrs30d: 4,
  githubMergedPrs90d: 11,
  githubExternalIssues30d: 2,
  githubExternalIssues90d: 6,
  githubLatestReleaseAt: '2026-07-01T10:00:00.000Z',
  githubLatestReleaseTag: 'v2.1.0',
  githubReleaseDownloads: 1400,
  githubCiState: 'success',
  githubContributorCount: 12,
  githubTrafficViews: 820,
  githubTrafficUniqueVisitors: 210,
  githubTrafficClones: 94,
  githubTrafficUniqueCloners: 37,
  githubAvailability: 'available',
  githubTrafficAvailability: 'available',
  gitScannedAt: '2026-07-19T11:59:00.000Z',
  tdScannedAt: '2026-07-19T11:59:00.000Z',
  githubScannedAt: '2026-07-19T11:59:00.000Z',
  githubTrafficScannedAt: '2026-07-19T11:59:00.000Z'
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_stars',
  capturedOn: '2026-06-18',
  value: 110
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_traffic_views',
  capturedOn: '2026-06-18',
  value: 700
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_traffic_clones',
  capturedOn: '2026-06-18',
  value: 70
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

const dormant = await repository.upsertDiscovered({
  canonicalPath: '/code/dormant',
  relativePath: 'dormant',
  name: 'dormant',
  scanRoot: '/code'
});
await repository.updateMetrics(dormant.id, {
  branch: 'main',
  latestCommitAt: '2026-01-01T00:00:00.000Z',
  commitCount: 12,
  commits7d: 0,
  commits30d: 0,
  commits90d: 0,
  activeDays30d: 0,
  githubRepoId: 'R_dormant',
  githubOwner: 'example',
  githubName: 'dormant',
  githubStars: 0,
  githubExternalPrs: 0,
  githubExternalIssues30d: 0,
  githubAvailability: 'available',
  gitScannedAt: '2026-07-19T11:59:00.000Z',
  githubScannedAt: '2026-07-19T11:59:00.000Z'
});
await repository.saveSnapshot({
  projectId: dormant.id,
  metric: 'github_stars',
  capturedOn: '2026-06-18',
  value: 0
});

const unicode = await repository.upsertDiscovered({
  canonicalPath: '/code/tools/café catalog',
  relativePath: 'tools/café catalog',
  name: 'café catalog',
  scanRoot: '/code'
});
await repository.updateNote(unicode.id, 'small Unicode-path utility ready for a focused pass');
await repository.updateMetrics(unicode.id, {
  branch: 'main',
  latestCommitAt: '2026-07-12T08:00:00.000Z',
  latestCommitSubject: 'Normalize catalog labels',
  commitCount: 38,
  commits7d: 1,
  commits30d: 5,
  activeDays30d: 3,
  dirtyFiles: 1,
  locCode: 3_240,
  dominantLanguage: 'Rust',
  tdTotalNonClosedCount: 3,
  gitScannedAt: '2026-07-19T11:59:00.000Z',
  tdScannedAt: '2026-07-19T11:59:00.000Z'
});

const hidden = await repository.upsertDiscovered({
  canonicalPath: '/code/archive/manual-notes',
  relativePath: 'archive/manual-notes',
  name: 'manual-notes',
  scanRoot: '/code'
});
await repository.updateNote(hidden.id, 'hidden intentionally; revisit after autumn');
await repository.setFavorite(hidden.id, true);
await repository.setHidden(hidden.id, true);

await repository.createScanRun({
  id: 'scan-e2e',
  reason: 'cli',
  status: 'running',
  startedAt: '2026-07-19T11:55:00.000Z',
  finishedAt: null,
  discoveredCount: 3,
  updatedCount: 3,
  errorCount: 1
});
await repository.finishScanRun(
  'scan-e2e',
  'completed',
  { discoveredCount: 3, updatedCount: 3, errorCount: 1 },
  '2026-07-19T12:00:00.000Z'
);
catalog.close();
