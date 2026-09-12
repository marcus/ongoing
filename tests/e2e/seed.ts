import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogDatabase } from '../../src/lib/server/catalog/database';
import { CatalogRepository } from '../../src/lib/server/catalog/repository';

const path = resolve(process.env.DATABASE_PATH ?? '.data/ongoing-e2e.sqlite');
const scanRoot = resolve(process.env.SCAN_ROOTS ?? '.data/e2e-unscanned');
mkdirSync(scanRoot, { recursive: true });
rmSync(path, { force: true });
rmSync(`${path}-shm`, { force: true });
rmSync(`${path}-wal`, { force: true });

const catalog = new CatalogDatabase(path);

// Every timestamp is relative to the moment the fixture is built. Fixed dates rot: the attention
// rules gate on how fresh a collector's data is, so a seed written in July classifies differently
// in September and the browser tests start failing for reasons that have nothing to do with the
// code under test.
const now = new Date();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (milliseconds: number): string => new Date(now.getTime() - milliseconds).toISOString();
const agoDate = (days: number): string => ago(days * DAY).slice(0, 10);

const repository = new CatalogRepository(catalog, () => now.toISOString());

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
  latestCommitAt: ago(2 * HOUR),
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
  githubOldestExternalPrAt: ago(37 * DAY),
  githubMergedPrs30d: 4,
  githubMergedPrs90d: 11,
  githubExternalIssues30d: 2,
  githubExternalIssues90d: 6,
  githubLatestReleaseAt: ago(18 * DAY),
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
  gitScannedAt: ago(1 * MINUTE),
  tdScannedAt: ago(1 * MINUTE),
  githubScannedAt: ago(1 * MINUTE),
  githubTrafficScannedAt: ago(1 * MINUTE)
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_stars',
  capturedOn: agoDate(31),
  value: 110
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_traffic_views',
  capturedOn: agoDate(31),
  value: 700
});
await repository.saveSnapshot({
  projectId: alpha.id,
  metric: 'github_traffic_clones',
  capturedOn: agoDate(31),
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
  latestCommitAt: ago(1 * DAY),
  latestCommitSubject: 'Build catalog',
  commitCount: 420,
  commits7d: 3,
  commits30d: 7,
  commits90d: 20,
  activeDays30d: 4,
  locCode: 18_200,
  dominantLanguage: 'Go',
  tdTotalNonClosedCount: 2,
  gitScannedAt: ago(1 * MINUTE)
});
await repository.recordCollectionError({
  projectId: beta.id,
  collector: 'hosting',
  message: 'GitHub credentials unavailable',
  occurredAt: ago(2 * MINUTE)
});

const dormant = await repository.upsertDiscovered({
  canonicalPath: '/code/dormant',
  relativePath: 'dormant',
  name: 'dormant',
  scanRoot: '/code'
});
await repository.updateMetrics(dormant.id, {
  branch: 'main',
  latestCommitAt: ago(200 * DAY),
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
  gitScannedAt: ago(1 * MINUTE),
  githubScannedAt: ago(1 * MINUTE)
});
await repository.saveSnapshot({
  projectId: dormant.id,
  metric: 'github_stars',
  capturedOn: agoDate(31),
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
  latestCommitAt: ago(7 * DAY),
  latestCommitSubject: 'Normalize catalog labels',
  commitCount: 38,
  commits7d: 1,
  commits30d: 5,
  activeDays30d: 3,
  dirtyFiles: 1,
  locCode: 3_240,
  dominantLanguage: 'Rust',
  tdTotalNonClosedCount: 3,
  gitScannedAt: ago(1 * MINUTE),
  tdScannedAt: ago(1 * MINUTE)
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

const secondHidden = await repository.upsertDiscovered({
  canonicalPath: '/code/archive/quiet-archive',
  relativePath: 'archive/quiet-archive',
  name: 'quiet-archive',
  scanRoot: '/code'
});
await repository.updateNote(
  secondHidden.id,
  'another hidden project for semantic restore coverage'
);
await repository.setHidden(secondHidden.id, true);

// Phase 3's radar in miniature: two technologies with rings, one of them past its review date, and
// the `uses` edges the radar page counts and the fact sheets render.
const go = await repository.createEntry({
  kind: 'technology',
  name: 'Go',
  slug: 'go',
  attributes: { technology_kind: 'language', ring: 'hot' },
  reviewAfter: agoDate(-120)
});
const jquery = await repository.createEntry({
  kind: 'technology',
  name: 'jQuery',
  slug: 'jquery',
  attributes: { technology_kind: 'library', ring: 'out' },
  reviewAfter: agoDate(30)
});
await repository.addRelation({
  fromId: beta.id,
  toId: go.id,
  kind: 'uses',
  attributes: { version: '1.27', sourceFile: 'go.mod' }
});
await repository.addRelation({
  fromId: unicode.id,
  toId: go.id,
  kind: 'uses',
  attributes: { version: '1.26', sourceFile: 'go.mod' }
});
await repository.addRelation({
  fromId: alpha.id,
  toId: jquery.id,
  kind: 'uses',
  attributes: { version: '3.6.0', sourceFile: 'package.json' }
});

await repository.createScanRun({
  id: 'scan-e2e',
  reason: 'cli',
  status: 'running',
  startedAt: ago(5 * MINUTE),
  finishedAt: null,
  discoveredCount: 3,
  updatedCount: 3,
  errorCount: 1
});
await repository.finishScanRun(
  'scan-e2e',
  'completed',
  { discoveredCount: 3, updatedCount: 3, errorCount: 1 },
  now.toISOString()
);
catalog.close();
