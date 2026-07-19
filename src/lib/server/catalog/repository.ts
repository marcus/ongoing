import type { Database, SQLQueryBindings } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  CollectionError,
  Collector,
  MetricSnapshot,
  ProjectMetrics,
  ScanRun,
  ScanStatus,
  SnapshotMetric
} from '$lib/domain/metrics';
import {
  assignManualRanks,
  validateDecisionUpdate,
  validateProjectNote,
  type DiscoveredProject,
  type Project,
  type ProjectDecisionUpdate
} from '$lib/domain/project';
import { CatalogDatabase } from './database';

type Row = Record<string, string | number | null>;
type ProjectMetricsUpdate = Partial<Omit<ProjectMetrics, 'projectId'>>;

const metricColumns: Record<keyof ProjectMetricsUpdate, string> = {
  headSha: 'head_sha',
  branch: 'branch',
  latestCommitAt: 'latest_commit_at',
  latestCommitSubject: 'latest_commit_subject',
  latestCommitShortSha: 'latest_commit_short_sha',
  commitCount: 'commit_count',
  commits7d: 'commits_7d',
  commits30d: 'commits_30d',
  commits90d: 'commits_90d',
  activeDays30d: 'active_days_30d',
  activeDays90d: 'active_days_90d',
  churnAdded30d: 'churn_added_30d',
  churnDeleted30d: 'churn_deleted_30d',
  churnAdded90d: 'churn_added_90d',
  churnDeleted90d: 'churn_deleted_90d',
  contributorCount: 'contributor_count',
  localAuthorCommitShare30d: 'local_author_commit_share_30d',
  dirtyFiles: 'dirty_files',
  aheadCount: 'ahead_count',
  behindCount: 'behind_count',
  latestTag: 'latest_tag',
  commitsSinceLatestTag: 'commits_since_latest_tag',
  locCode: 'loc_code',
  locComment: 'loc_comment',
  locBlank: 'loc_blank',
  locFiles: 'loc_files',
  locTest: 'loc_test',
  dominantLanguage: 'dominant_language',
  locFingerprint: 'loc_fingerprint',
  tdOpenCount: 'td_open_count',
  tdInProgressCount: 'td_in_progress_count',
  tdBlockedCount: 'td_blocked_count',
  tdReviewCount: 'td_review_count',
  tdTotalNonClosedCount: 'td_total_non_closed_count',
  tdStaleCount: 'td_stale_count',
  githubRepoId: 'github_repo_id',
  githubOwner: 'github_owner',
  githubName: 'github_name',
  githubVisibility: 'github_visibility',
  githubIsArchived: 'github_is_archived',
  githubStars: 'github_stars',
  githubForks: 'github_forks',
  githubWatchers: 'github_watchers',
  githubOpenIssues: 'github_open_issues',
  githubOpenPrs: 'github_open_prs',
  githubDraftPrs: 'github_draft_prs',
  githubReadyPrs: 'github_ready_prs',
  githubOwnerPrs: 'github_owner_prs',
  githubExternalPrs: 'github_external_prs',
  githubOldestExternalPrAt: 'github_oldest_external_pr_at',
  githubMergedPrs30d: 'github_merged_prs_30d',
  githubMergedPrs90d: 'github_merged_prs_90d',
  githubExternalIssues30d: 'github_external_issues_30d',
  githubExternalIssues90d: 'github_external_issues_90d',
  githubLatestReleaseAt: 'github_latest_release_at',
  githubLatestReleaseTag: 'github_latest_release_tag',
  githubReleaseDownloads: 'github_release_downloads',
  githubCiState: 'github_ci_state',
  githubContributorCount: 'github_contributor_count',
  githubTrafficViews: 'github_traffic_views',
  githubTrafficUniqueVisitors: 'github_traffic_unique_visitors',
  githubTrafficClones: 'github_traffic_clones',
  githubTrafficUniqueCloners: 'github_traffic_unique_cloners',
  githubAvailability: 'github_availability',
  githubTrafficAvailability: 'github_traffic_availability',
  gitScannedAt: 'git_scanned_at',
  locScannedAt: 'loc_scanned_at',
  tdScannedAt: 'td_scanned_at',
  githubScannedAt: 'github_scanned_at',
  githubTrafficScannedAt: 'github_traffic_scanned_at'
};

function bool(value: string | number | null): boolean {
  return value === 1;
}

function nullableBool(value: string | number | null): boolean | null {
  return value === null ? null : bool(value);
}

function projectFromRow(row: Row): Project {
  return {
    id: String(row.id),
    canonicalPath: String(row.canonical_path),
    relativePath: String(row.relative_path),
    name: String(row.name),
    scanRoot: String(row.scan_root),
    isFavorite: bool(row.is_favorite),
    isHidden: bool(row.is_hidden),
    manualRank: Number(row.manual_rank),
    note: String(row.note),
    intent: row.intent as Project['intent'],
    excitement: row.excitement === null ? null : Number(row.excitement),
    strategicImportance:
      row.strategic_importance === null ? null : Number(row.strategic_importance),
    nextAction: row.next_action === null ? null : String(row.next_action),
    reviewAfter: row.review_after === null ? null : String(row.review_after),
    isMissing: bool(row.is_missing),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    updatedAt: String(row.updated_at)
  };
}

function metricsFromRow(row: Row): ProjectMetrics {
  const number = (key: string): number | null => (row[key] === null ? null : Number(row[key]));
  const string = (key: string): string | null => (row[key] === null ? null : String(row[key]));
  return {
    projectId: String(row.project_id),
    headSha: string('head_sha'),
    branch: string('branch'),
    latestCommitAt: string('latest_commit_at'),
    latestCommitSubject: string('latest_commit_subject'),
    latestCommitShortSha: string('latest_commit_short_sha'),
    commitCount: number('commit_count'),
    commits7d: number('commits_7d'),
    commits30d: number('commits_30d'),
    commits90d: number('commits_90d'),
    activeDays30d: number('active_days_30d'),
    activeDays90d: number('active_days_90d'),
    churnAdded30d: number('churn_added_30d'),
    churnDeleted30d: number('churn_deleted_30d'),
    churnAdded90d: number('churn_added_90d'),
    churnDeleted90d: number('churn_deleted_90d'),
    contributorCount: number('contributor_count'),
    localAuthorCommitShare30d: number('local_author_commit_share_30d'),
    dirtyFiles: number('dirty_files'),
    aheadCount: number('ahead_count'),
    behindCount: number('behind_count'),
    latestTag: string('latest_tag'),
    commitsSinceLatestTag: number('commits_since_latest_tag'),
    locCode: number('loc_code'),
    locComment: number('loc_comment'),
    locBlank: number('loc_blank'),
    locFiles: number('loc_files'),
    locTest: number('loc_test'),
    dominantLanguage: string('dominant_language'),
    locFingerprint: string('loc_fingerprint'),
    tdOpenCount: number('td_open_count'),
    tdInProgressCount: number('td_in_progress_count'),
    tdBlockedCount: number('td_blocked_count'),
    tdReviewCount: number('td_review_count'),
    tdTotalNonClosedCount: number('td_total_non_closed_count'),
    tdStaleCount: number('td_stale_count'),
    githubRepoId: string('github_repo_id'),
    githubOwner: string('github_owner'),
    githubName: string('github_name'),
    githubVisibility: string('github_visibility') as ProjectMetrics['githubVisibility'],
    githubIsArchived: nullableBool(row.github_is_archived),
    githubStars: number('github_stars'),
    githubForks: number('github_forks'),
    githubWatchers: number('github_watchers'),
    githubOpenIssues: number('github_open_issues'),
    githubOpenPrs: number('github_open_prs'),
    githubDraftPrs: number('github_draft_prs'),
    githubReadyPrs: number('github_ready_prs'),
    githubOwnerPrs: number('github_owner_prs'),
    githubExternalPrs: number('github_external_prs'),
    githubOldestExternalPrAt: string('github_oldest_external_pr_at'),
    githubMergedPrs30d: number('github_merged_prs_30d'),
    githubMergedPrs90d: number('github_merged_prs_90d'),
    githubExternalIssues30d: number('github_external_issues_30d'),
    githubExternalIssues90d: number('github_external_issues_90d'),
    githubLatestReleaseAt: string('github_latest_release_at'),
    githubLatestReleaseTag: string('github_latest_release_tag'),
    githubReleaseDownloads: number('github_release_downloads'),
    githubCiState: string('github_ci_state') as ProjectMetrics['githubCiState'],
    githubContributorCount: number('github_contributor_count'),
    githubTrafficViews: number('github_traffic_views'),
    githubTrafficUniqueVisitors: number('github_traffic_unique_visitors'),
    githubTrafficClones: number('github_traffic_clones'),
    githubTrafficUniqueCloners: number('github_traffic_unique_cloners'),
    githubAvailability: string('github_availability') as ProjectMetrics['githubAvailability'],
    githubTrafficAvailability: string(
      'github_traffic_availability'
    ) as ProjectMetrics['githubTrafficAvailability'],
    gitScannedAt: string('git_scanned_at'),
    locScannedAt: string('loc_scanned_at'),
    tdScannedAt: string('td_scanned_at'),
    githubScannedAt: string('github_scanned_at'),
    githubTrafficScannedAt: string('github_traffic_scanned_at')
  };
}

function requireChanged(changes: number, projectId: string): void {
  if (changes === 0) throw new Error(`Unknown project ID: ${projectId}`);
}

export function stableProjectId(canonicalPath: string): string {
  const normalized = resolve(canonicalPath);
  return `project_${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

export class CatalogRepository {
  constructor(
    private readonly catalog: CatalogDatabase,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  get database(): Database {
    return this.catalog.sqlite;
  }

  async upsertDiscovered(project: DiscoveredProject): Promise<Project> {
    return this.catalog.write((database) => {
      const timestamp = this.now();
      const id = stableProjectId(project.canonicalPath);
      const transaction = database.transaction(() => {
        const rank =
          Number(
            database
              .query<Row, []>('SELECT COALESCE(MAX(manual_rank), 0) AS rank FROM projects')
              .get()?.rank ?? 0
          ) + 1_000;
        database
          .query(
            `
          INSERT INTO projects (
            id, canonical_path, relative_path, name, scan_root, manual_rank,
            first_seen_at, last_seen_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(canonical_path) DO UPDATE SET
            relative_path = excluded.relative_path,
            name = excluded.name,
            scan_root = excluded.scan_root,
            is_missing = 0,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        `
          )
          .run(
            id,
            resolve(project.canonicalPath),
            project.relativePath,
            project.name,
            resolve(project.scanRoot),
            rank,
            timestamp,
            timestamp,
            timestamp
          );
        return database
          .query<Row, [string]>('SELECT * FROM projects WHERE canonical_path = ?')
          .get(resolve(project.canonicalPath));
      });
      const row = transaction.immediate();
      if (!row) throw new Error('Failed to persist discovered project');
      return projectFromRow(row);
    });
  }

  getProject(id: string): Project | null {
    const row = this.database.query<Row, [string]>('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? projectFromRow(row) : null;
  }

  listProjects(options: { includeHidden?: boolean } = {}): Project[] {
    const sql = options.includeHidden
      ? 'SELECT * FROM projects ORDER BY manual_rank, name, id'
      : 'SELECT * FROM projects WHERE is_hidden = 0 ORDER BY manual_rank, name, id';
    return this.database.query<Row, []>(sql).all().map(projectFromRow);
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.updateProjectFlag(id, 'is_favorite', favorite);
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    await this.updateProjectFlag(id, 'is_hidden', hidden);
  }

  async setMissing(id: string, missing: boolean): Promise<void> {
    await this.updateProjectFlag(id, 'is_missing', missing);
  }

  private async updateProjectFlag(
    id: string,
    column: 'is_favorite' | 'is_hidden' | 'is_missing',
    value: boolean
  ): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query(`UPDATE projects SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .run(value ? 1 : 0, this.now(), id);
      requireChanged(result.changes, id);
    });
  }

  async updateNote(id: string, note: string): Promise<void> {
    validateProjectNote(note);
    await this.catalog.write((database) => {
      const result = database
        .query('UPDATE projects SET note = ?, updated_at = ? WHERE id = ?')
        .run(note, this.now(), id);
      requireChanged(result.changes, id);
    });
  }

  async updateDecision(id: string, update: ProjectDecisionUpdate): Promise<void> {
    validateDecisionUpdate(update);
    const entries = Object.entries(update).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const columns: Record<string, string> = {
      intent: 'intent',
      excitement: 'excitement',
      strategicImportance: 'strategic_importance',
      nextAction: 'next_action',
      reviewAfter: 'review_after'
    };
    await this.catalog.write((database) => {
      const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
      const result = database
        .query(`UPDATE projects SET ${assignments}, updated_at = ? WHERE id = ?`)
        .run(...entries.map(([, value]) => value ?? null), this.now(), id);
      requireChanged(result.changes, id);
    });
  }

  async markUnseenMissing(
    scanRoots: readonly string[],
    seenProjectIds: readonly string[]
  ): Promise<void> {
    await this.catalog.write((database) => {
      const seen = new Set(seenProjectIds);
      const transaction = database.transaction(() => {
        for (const scanRoot of scanRoots) {
          const rows = database
            .query<{ id: string }, [string]>('SELECT id FROM projects WHERE scan_root = ?')
            .all(resolve(scanRoot));
          for (const { id } of rows) {
            if (!seen.has(id))
              database
                .query('UPDATE projects SET is_missing = 1, updated_at = ? WHERE id = ?')
                .run(this.now(), id);
          }
        }
      });
      transaction.immediate();
    });
  }

  async reorderVisibleProjects(orderedIds: readonly string[]): Promise<void> {
    await this.catalog.write((database) => {
      const transaction = database.transaction(() => {
        const expectedIds = database
          .query<{ id: string }, []>('SELECT id FROM projects WHERE is_hidden = 0')
          .all()
          .map(({ id }) => id);
        const ranks = assignManualRanks(orderedIds, expectedIds);
        const update = database.query(
          'UPDATE projects SET manual_rank = ?, updated_at = ? WHERE id = ?'
        );
        const timestamp = this.now();
        for (const [id, rank] of ranks) update.run(rank, timestamp, id);
      });
      transaction.immediate();
    });
  }

  getMetrics(projectId: string): ProjectMetrics | null {
    const row = this.database
      .query<Row, [string]>('SELECT * FROM project_metrics WHERE project_id = ?')
      .get(projectId);
    return row ? metricsFromRow(row) : null;
  }

  async updateMetrics(projectId: string, update: ProjectMetricsUpdate): Promise<void> {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined) as [
      keyof ProjectMetricsUpdate,
      Exclude<ProjectMetricsUpdate[keyof ProjectMetricsUpdate], undefined>
    ][];
    if (entries.length === 0) return;
    await this.catalog.write((database) => {
      if (!this.getProject(projectId)) throw new Error(`Unknown project ID: ${projectId}`);
      database
        .query(
          'INSERT INTO project_metrics (project_id) VALUES (?) ON CONFLICT(project_id) DO NOTHING'
        )
        .run(projectId);
      const assignments = entries.map(([key]) => `${metricColumns[key]} = ?`).join(', ');
      const values: SQLQueryBindings[] = entries.map(([, value]) =>
        typeof value === 'boolean' ? (value ? 1 : 0) : value
      );
      database
        .query(`UPDATE project_metrics SET ${assignments} WHERE project_id = ?`)
        .run(...values, projectId);
    });
  }

  async saveSnapshot(snapshot: MetricSnapshot): Promise<void> {
    await this.catalog.write((database) => {
      database
        .query(
          `
        INSERT INTO metric_snapshots (project_id, metric, captured_on, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, metric, captured_on) DO UPDATE SET value = excluded.value
      `
        )
        .run(snapshot.projectId, snapshot.metric, snapshot.capturedOn, snapshot.value);
    });
  }

  listSnapshots(projectId: string, metric?: SnapshotMetric): MetricSnapshot[] {
    const rows = metric
      ? this.database
          .query<Row, [string, string]>(
            'SELECT * FROM metric_snapshots WHERE project_id = ? AND metric = ? ORDER BY captured_on'
          )
          .all(projectId, metric)
      : this.database
          .query<Row, [string]>(
            'SELECT * FROM metric_snapshots WHERE project_id = ? ORDER BY metric, captured_on'
          )
          .all(projectId);
    return rows.map((row) => ({
      projectId: String(row.project_id),
      metric: String(row.metric) as SnapshotMetric,
      capturedOn: String(row.captured_on),
      value: Number(row.value)
    }));
  }

  async recordCollectionError(error: Omit<CollectionError, 'resolvedAt'>): Promise<void> {
    await this.catalog.write((database) => {
      database
        .query(
          `
        INSERT INTO collection_errors (project_id, collector, message, occurred_at, resolved_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(project_id, collector) DO UPDATE SET
          message = excluded.message, occurred_at = excluded.occurred_at, resolved_at = NULL
      `
        )
        .run(error.projectId, error.collector, error.message, error.occurredAt);
    });
  }

  async resolveCollectionError(
    projectId: string,
    collector: Collector,
    resolvedAt = this.now()
  ): Promise<void> {
    await this.catalog.write((database) => {
      database
        .query(
          'UPDATE collection_errors SET resolved_at = ? WHERE project_id = ? AND collector = ?'
        )
        .run(resolvedAt, projectId, collector);
    });
  }

  listCollectionErrors(projectId: string, activeOnly = false): CollectionError[] {
    const sql = `SELECT * FROM collection_errors WHERE project_id = ?${activeOnly ? ' AND resolved_at IS NULL' : ''} ORDER BY occurred_at`;
    return this.database
      .query<Row, [string]>(sql)
      .all(projectId)
      .map((row) => ({
        projectId: String(row.project_id),
        collector: String(row.collector) as Collector,
        message: String(row.message),
        occurredAt: String(row.occurred_at),
        resolvedAt: row.resolved_at === null ? null : String(row.resolved_at)
      }));
  }

  async createScanRun(run: ScanRun): Promise<void> {
    await this.catalog.write((database) => {
      database
        .query(
          `
        INSERT INTO scan_runs (id, reason, status, started_at, finished_at, discovered_count, updated_count, error_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          run.id,
          run.reason,
          run.status,
          run.startedAt,
          run.finishedAt,
          run.discoveredCount,
          run.updatedCount,
          run.errorCount
        );
    });
  }

  async finishScanRun(
    id: string,
    status: Exclude<ScanStatus, 'running'>,
    counts: Pick<ScanRun, 'discoveredCount' | 'updatedCount' | 'errorCount'>,
    finishedAt = this.now()
  ): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query(
          `
        UPDATE scan_runs SET status = ?, finished_at = ?, discovered_count = ?, updated_count = ?, error_count = ?
        WHERE id = ? AND status = 'running'
      `
        )
        .run(
          status,
          finishedAt,
          counts.discoveredCount,
          counts.updatedCount,
          counts.errorCount,
          id
        );
      if (result.changes === 0) throw new Error(`Unknown or already finished scan run: ${id}`);
    });
  }

  getScanRun(id: string): ScanRun | null {
    const row = this.database.query<Row, [string]>('SELECT * FROM scan_runs WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: String(row.id),
      reason: String(row.reason) as ScanRun['reason'],
      status: String(row.status) as ScanStatus,
      startedAt: String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
      discoveredCount: Number(row.discovered_count),
      updatedCount: Number(row.updated_count),
      errorCount: Number(row.error_count)
    };
  }
}
