import { updateWebsite, type ProjectWebsite } from '$lib/domain/website';
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
  EntryValidationError,
  slugify,
  uniqueSlug,
  validateSlug,
  type AttributeValue,
  type Entry,
  type EntryInput,
  type EntrySource
} from '$lib/domain/entry';
import {
  createFieldRegistry,
  validateEntryPatch,
  validateFieldDefinition,
  type FieldDefinition,
  type FieldRegistry,
  type FieldType
} from '$lib/domain/fields';
import {
  validateRelation,
  type Relation,
  type RelationEvidence,
  type RelationInput
} from '$lib/domain/relation';
import {
  builtinSavedViews,
  mergeSavedViews,
  SavedViewValidationError,
  validateSavedView,
  type SavedView,
  type SavedViewInput
} from '$lib/domain/view';
import {
  assignManualRanks,
  validateDecisionUpdate,
  validateProjectNote,
  type DiscoveredProject,
  type Project,
  type ProjectDecisionUpdate
} from '$lib/domain/project';
import {
  TECH_SIGNATURES_PROVIDER,
  TECHNOLOGY_KIND,
  type DetectedTechnology
} from '$lib/domain/technology';
import type {
  DeclaredStack,
  Toolchain,
  ToolchainBaselineStatus,
  ToolchainRelease,
  ToolchainReleaseCycle
} from '$lib/domain/stack';
import type { CatalogDatabase } from './database';

type Row = Record<string, string | number | null>;
type ProjectMetricsUpdate = Partial<Omit<ProjectMetrics, 'projectId'>>;

/** The provider that owns locally discovered entries; its locator is the canonical path. */
export const FILESYSTEM_PROVIDER = 'filesystem';

export interface ScanLeaseOwnership {
  runId: string;
  owner: string;
}

export class ScanLeaseLostError extends Error {
  constructor(readonly runId: string) {
    super(`Scan lease lost: ${runId}`);
    this.name = 'ScanLeaseLostError';
  }
}

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
  stackScannedAt: 'stack_scanned_at',
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

function parseObject(value: string | number | null): Record<string, AttributeValue> {
  if (typeof value !== 'string' || !value) return {};
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, AttributeValue>)
    : {};
}

function parseStrings(value: string | number | null): string[] {
  if (typeof value !== 'string' || !value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function entryFromRow(row: Row): Entry {
  return {
    id: String(row.id),
    kind: String(row.kind),
    slug: String(row.slug),
    name: String(row.name),
    note: String(row.note ?? ''),
    tags: parseStrings(row.tags),
    isFavorite: bool(row.is_favorite),
    isHidden: bool(row.is_hidden),
    attributes: parseObject(row.attributes),
    reviewAfter: row.review_after === null ? null : String(row.review_after),
    website: row.website_json ? (JSON.parse(String(row.website_json)) as ProjectWebsite) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function sourceFromRow(row: Row): EntrySource {
  return {
    entryId: String(row.entry_id),
    provider: String(row.provider),
    locator: String(row.locator),
    metadata: parseObject(row.metadata) as Record<string, unknown>,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    missingSince: row.missing_since === null ? null : String(row.missing_since)
  };
}

function fieldFromRow(row: Row): FieldDefinition {
  return {
    key: String(row.key),
    kinds: parseStrings(row.kinds),
    type: String(row.type) as FieldType,
    options: row.options
      ? (JSON.parse(String(row.options)) as FieldDefinition['options'])
      : undefined,
    owner: 'user',
    label: String(row.label),
    description: row.description === null ? undefined : String(row.description),
    sortable: bool(row.sortable),
    filterable: bool(row.filterable),
    editable: bool(row.editable),
    required: bool(row.required),
    storage: 'attribute'
  };
}

function relationFromRow(row: Row): Relation {
  return {
    id: String(row.id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    kind: String(row.kind),
    evidence: String(row.evidence) as RelationEvidence,
    provider: row.provider === null ? null : String(row.provider),
    attributes: parseObject(row.attributes),
    note: row.note === null ? null : String(row.note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function viewFromRow(row: Row): SavedView {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind === null ? null : String(row.kind),
    query: String(row.query ?? ''),
    columns: parseStrings(row.columns),
    position: Number(row.position),
    builtin: false,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

/** The project view of an entry: its filesystem source supplies everything discovery owns. */
function projectFromEntry(entry: Entry, source: EntrySource): Project {
  const metadata = source.metadata as { relativePath?: string; scanRoot?: string };
  const number = (key: string): number | null => {
    const value = entry.attributes[key];
    return typeof value === 'number' ? value : null;
  };
  const text = (key: string): string | null => {
    const value = entry.attributes[key];
    return typeof value === 'string' ? value : null;
  };
  return {
    id: entry.id,
    slug: entry.slug,
    canonicalPath: source.locator,
    relativePath: metadata.relativePath ?? source.locator,
    name: entry.name,
    scanRoot: metadata.scanRoot ?? '',
    isFavorite: entry.isFavorite,
    isHidden: entry.isHidden,
    manualRank: number('manual_rank') ?? 0,
    note: entry.note,
    tags: entry.tags,
    attributes: entry.attributes,
    website: entry.website,
    intent: text('intent') as Project['intent'],
    excitement: number('excitement'),
    strategicImportance: number('strategic_importance'),
    nextAction: text('next_action'),
    reviewAfter: entry.reviewAfter,
    isMissing: source.missingSince !== null,
    missingSince: source.missingSince,
    firstSeenAt: source.firstSeenAt,
    lastSeenAt: source.lastSeenAt,
    updatedAt: entry.updatedAt
  };
}

function entryExists(database: Database, entryId: string): boolean {
  return Boolean(
    database.query<{ id: string }, [string]>('SELECT id FROM entries WHERE id = ?').get(entryId)
  );
}

function requireChanged(changes: number, projectId: string): void {
  if (changes === 0) throw new Error(`Unknown project ID: ${projectId}`);
}

function withLease<T>(
  database: Database,
  lease: ScanLeaseOwnership | undefined,
  operation: () => T
): T {
  const transaction = database.transaction(() => {
    if (lease) {
      const current = database
        .query<{ current: number }, [string, string]>(
          `SELECT 1 AS current FROM scan_runs
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .get(lease.runId, lease.owner);
      if (!current) throw new ScanLeaseLostError(lease.runId);
    }
    return operation();
  });
  return transaction.immediate();
}

/** Stable per edge, so rewriting a detected relation reuses its row rather than churning ids. */
function relationId(fromId: string, toId: string, kind: string, evidence: string): string {
  return `relation_${createHash('sha256')
    .update(`${fromId}:${toId}:${kind}:${evidence}`)
    .digest('hex')
    .slice(0, 24)}`;
}

export function stableProjectId(canonicalPath: string): string {
  const normalized = resolve(canonicalPath);
  return `project_${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

/** Ids for entries no provider discovered — technologies, or anything created by hand. */
export function stableEntryId(kind: string, slug: string): string {
  return `${kind}_${createHash('sha256').update(`${kind}:${slug}`).digest('hex').slice(0, 24)}`;
}

/**
 * Ids for entries a non-filesystem provider discovered, keyed by what that provider calls them —
 * `github:owner/name` — so a remote repository keeps its notes and rank across scans the way a
 * local checkout keeps them across a path that never changes.
 */
export function stableRemoteId(provider: string, locator: string): string {
  return `project_${createHash('sha256').update(`${provider}:${locator}`).digest('hex').slice(0, 24)}`;
}

/**
 * The catalog store, expressed in entries.
 *
 * Callers see entries, sources, fields, relations, views, and the project projection of an entry —
 * never SQL, never the attributes JSON layout. Attribute filtering and sorting happen here in the
 * read model rather than through SQLite's JSON functions, so the store interface stays key, record,
 * and simple scan (ADR 0005).
 */
export type ProviderRunStatus = 'ok' | 'skipped' | 'disabled' | 'unavailable' | 'failed';

export interface ProviderRun {
  provider: string;
  status: ProviderRunStatus;
  lastRunAt: string;
  runId?: string | null;
  detail?: string | null;
}

export interface CatalogRepositoryOptions {
  /**
   * The providers whose manifests may contribute fields. Omitted registers every shipped provider,
   * which is what a test or a caller with no configuration should see; the server passes the
   * enabled, available set so a disabled provider's fields never enter the registry (ADR 0007).
   */
  providers?: readonly string[];
}

export class CatalogRepository {
  private registryCache: FieldRegistry | null = null;
  private providerFilter: readonly string[] | undefined;

  constructor(
    private readonly catalog: CatalogDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
    options: CatalogRepositoryOptions = {}
  ) {
    this.providerFilter = options.providers;
  }

  /**
   * Narrows the registry to the providers that can actually run. The scanner calls this once it has
   * probed the machine, so a field belonging to an unavailable provider stops being registered and
   * every rule that reads it goes inert rather than wrong.
   */
  setActiveProviders(providers: readonly string[]): void {
    const next = [...providers].sort();
    if (this.providerFilter && this.providerFilter.join() === next.join()) return;
    this.providerFilter = next;
    this.registryCache = null;
  }

  get activeProviders(): readonly string[] | undefined {
    return this.providerFilter;
  }

  get database(): Database {
    return this.catalog.sqlite;
  }

  /* ------------------------------------------------------------------ entries */

  getEntry(id: string): Entry | null {
    const row = this.database.query<Row, [string]>('SELECT * FROM entries WHERE id = ?').get(id);
    return row ? entryFromRow(row) : null;
  }

  getEntryBySlug(kind: string, slug: string): Entry | null {
    const row = this.database
      .query<Row, [string, string]>('SELECT * FROM entries WHERE kind = ? AND slug = ?')
      .get(kind, slug);
    return row ? entryFromRow(row) : null;
  }

  /** Ordered by manual rank, then name — the sort happens here, not in SQL over a JSON document. */
  listEntries(options: { kind?: string; includeHidden?: boolean } = {}): Entry[] {
    const rows = options.kind
      ? this.database.query<Row, [string]>('SELECT * FROM entries WHERE kind = ?').all(options.kind)
      : this.database.query<Row, []>('SELECT * FROM entries').all();
    const entries = rows.map(entryFromRow);
    const visible = options.includeHidden ? entries : entries.filter((entry) => !entry.isHidden);
    return visible.sort((left, right) => {
      const rank = manualRank(left) - manualRank(right);
      if (rank !== 0) return rank;
      return left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en');
    });
  }

  async createEntry(input: EntryInput): Promise<Entry> {
    const registry = this.registry();
    const patch = validateEntryPatch(registry, input.kind, {
      name: input.name,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.reviewAfter === undefined ? {} : { review_after: input.reviewAfter }),
      ...(input.attributes ?? {})
    });
    return this.catalog.write((database) => {
      const taken = database
        .query<{ slug: string }, [string]>('SELECT slug FROM entries WHERE kind = ?')
        .all(input.kind)
        .map(({ slug }) => slug);
      const preferred = input.slug ? input.slug : slugify(input.name);
      if (input.slug) {
        validateSlug(input.slug);
        if (taken.includes(input.slug))
          throw new EntryValidationError(
            `Slug already used by another ${input.kind}: ${input.slug}`
          );
      }
      const slug = uniqueSlug(preferred, taken);
      const id = stableEntryId(input.kind, slug);
      const timestamp = this.now();
      const attributes: Record<string, AttributeValue> = { manual_rank: nextManualRank(database) };
      for (const [key, value] of Object.entries(patch.attributes))
        if (value === null) delete attributes[key];
        else attributes[key] = value;
      const columns = patch.columns;
      database
        .query(
          `INSERT INTO entries (
             id, kind, slug, name, note, tags, is_favorite, is_hidden, attributes, review_after,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.kind,
          slug,
          String(columns.name ?? input.name),
          String(columns.note ?? ''),
          JSON.stringify(columns.tags ?? []),
          columns.is_favorite === true ? 1 : 0,
          columns.is_hidden === true ? 1 : 0,
          JSON.stringify(attributes),
          (columns.review_after as string | null | undefined) ?? null,
          timestamp,
          timestamp
        );
      const row = database.query<Row, [string]>('SELECT * FROM entries WHERE id = ?').get(id);
      if (!row) throw new Error('Failed to persist entry');
      return entryFromRow(row);
    });
  }

  /**
   * The single write path for entry values: an untrusted patch keyed by field key, validated once
   * by {@link validateEntryPatch} and then written to whichever column or attribute holds it.
   */
  async patchEntry(id: string, patch: Record<string, unknown>): Promise<Entry> {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Unknown entry ID: ${id}`);
    const validated = validateEntryPatch(this.registry(), entry.kind, patch);
    if (!Object.keys(validated.columns).length && !Object.keys(validated.attributes).length)
      return entry;

    return this.catalog.write((database) => {
      const attributes = { ...entry.attributes };
      for (const [key, value] of Object.entries(validated.attributes))
        if (value === null) delete attributes[key];
        else attributes[key] = value;

      const assignments: string[] = [];
      const values: SQLQueryBindings[] = [];
      for (const [column, value] of Object.entries(validated.columns)) {
        if (column === 'slug') {
          const slug = String(value);
          const clash = database
            .query<{ id: string }, [string, string]>(
              'SELECT id FROM entries WHERE kind = ? AND slug = ?'
            )
            .get(entry.kind, slug);
          if (clash && clash.id !== id)
            throw new EntryValidationError(`Slug already used by another ${entry.kind}: ${slug}`);
        }
        assignments.push(`${column} = ?`);
        values.push(
          column === 'tags'
            ? JSON.stringify(value ?? [])
            : typeof value === 'boolean'
              ? value
                ? 1
                : 0
              : (value as SQLQueryBindings)
        );
      }
      assignments.push('attributes = ?');
      values.push(JSON.stringify(attributes));

      database
        .query(`UPDATE entries SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...values, this.now(), id);
      const row = database.query<Row, [string]>('SELECT * FROM entries WHERE id = ?').get(id);
      if (!row) throw new Error('Failed to persist entry');
      return entryFromRow(row);
    });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.catalog.write((database) => {
      const result = database.query('DELETE FROM entries WHERE id = ?').run(id);
      requireChanged(result.changes, id);
    });
  }

  /* ------------------------------------------------------------------ sources */

  listSources(entryId: string): EntrySource[] {
    return this.database
      .query<Row, [string]>('SELECT * FROM entry_sources WHERE entry_id = ? ORDER BY provider')
      .all(entryId)
      .map(sourceFromRow);
  }

  listAllSources(provider?: string): Map<string, EntrySource[]> {
    const rows = provider
      ? this.database
          .query<Row, [string]>('SELECT * FROM entry_sources WHERE provider = ?')
          .all(provider)
      : this.database.query<Row, []>('SELECT * FROM entry_sources').all();
    const grouped = new Map<string, EntrySource[]>();
    for (const row of rows) {
      const source = sourceFromRow(row);
      const sources = grouped.get(source.entryId) ?? [];
      sources.push(source);
      grouped.set(source.entryId, sources);
    }
    return grouped;
  }

  /* ------------------------------------------------------------------- fields */

  /** Built-in fields, provider fields, and the user's own, as one registry. */
  registry(): FieldRegistry {
    this.registryCache ??= createFieldRegistry(this.listUserFields(), {
      providers: this.providerFilter
    });
    return this.registryCache;
  }

  listUserFields(): FieldDefinition[] {
    return this.database
      .query<Row, []>('SELECT * FROM fields ORDER BY key')
      .all()
      .map(fieldFromRow);
  }

  async addUserField(input: Record<string, unknown>): Promise<FieldDefinition> {
    const definition = validateFieldDefinition(this.registry(), input);
    await this.catalog.write((database) => {
      const timestamp = this.now();
      database
        .query(
          `INSERT INTO fields (
             key, kinds, type, options, label, description, sortable, filterable, editable,
             required, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          definition.key,
          JSON.stringify(definition.kinds),
          definition.type,
          definition.options ? JSON.stringify(definition.options) : null,
          definition.label,
          definition.description ?? null,
          definition.sortable ? 1 : 0,
          definition.filterable ? 1 : 0,
          definition.required ? 1 : 0,
          timestamp,
          timestamp
        );
    });
    this.registryCache = null;
    return definition;
  }

  /**
   * Drops a user field and every value stored under it, so the catalog never carries attributes no
   * registry can explain.
   */
  async removeUserField(key: string): Promise<void> {
    await this.catalog.write((database) => {
      const result = database.query('DELETE FROM fields WHERE key = ?').run(key);
      if (result.changes === 0) throw new Error(`Unknown user field: ${key}`);
      const rows = database.query<Row, []>('SELECT id, attributes FROM entries').all();
      const update = database.query('UPDATE entries SET attributes = ? WHERE id = ?');
      for (const row of rows) {
        const attributes = parseObject(row.attributes);
        if (!(key in attributes)) continue;
        delete attributes[key];
        update.run(JSON.stringify(attributes), String(row.id));
      }
    });
    this.registryCache = null;
  }

  /* ---------------------------------------------------------------- relations */

  listRelations(filter: { entryId?: string; kind?: string } = {}): Relation[] {
    const relations = this.database
      .query<Row, []>('SELECT * FROM relations ORDER BY kind, created_at')
      .all()
      .map(relationFromRow);
    return relations.filter(
      (relation) =>
        (!filter.entryId ||
          relation.fromId === filter.entryId ||
          relation.toId === filter.entryId) &&
        (!filter.kind || relation.kind === filter.kind)
    );
  }

  async addRelation(input: RelationInput): Promise<Relation> {
    const from = this.getEntry(input.fromId);
    const to = this.getEntry(input.toId);
    if (!from) throw new Error(`Unknown entry ID: ${input.fromId}`);
    if (!to) throw new Error(`Unknown entry ID: ${input.toId}`);
    const evidence: RelationEvidence = input.evidence ?? 'declared';
    validateRelation({
      kind: input.kind,
      fromKind: from.kind,
      toKind: to.kind,
      evidence,
      note: input.note
    });
    const id = relationId(from.id, to.id, input.kind, evidence);
    return this.catalog.write((database) => {
      const timestamp = this.now();
      database
        .query(
          `INSERT INTO relations (
             id, from_id, to_id, kind, evidence, provider, attributes, note, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(from_id, to_id, kind, evidence) DO UPDATE SET
             provider = excluded.provider,
             attributes = excluded.attributes,
             note = excluded.note,
             updated_at = excluded.updated_at`
        )
        .run(
          id,
          from.id,
          to.id,
          input.kind,
          evidence,
          input.provider ?? null,
          JSON.stringify(input.attributes ?? {}),
          input.note ?? null,
          timestamp,
          timestamp
        );
      const row = database
        .query<Row, [string, string, string, string]>(
          'SELECT * FROM relations WHERE from_id = ? AND to_id = ? AND kind = ? AND evidence = ?'
        )
        .get(from.id, to.id, input.kind, evidence);
      if (!row) throw new Error('Failed to persist relation');
      return relationFromRow(row);
    });
  }

  /**
   * Rewrite one provider's detected edges out of a project. Detected rows belong to the provider
   * that wrote them (ADR 0005), so the whole set is replaced rather than merged, and a technology
   * that no longer appears in a manifest loses its edge on the next scan. Declared edges are not
   * touched: the same pair may hold both, and a person's note survives every scan.
   *
   * A detection for a technology the catalog does not hold is dropped, which is the radar's rule
   * that a signature only counts for a technology somebody catalogued.
   */
  async replaceDetectedTechnologyUsage(
    projectId: string,
    detections: readonly DetectedTechnology[],
    lease?: ScanLeaseOwnership
  ): Promise<number> {
    const technologies = new Map(
      this.listEntries({ kind: TECHNOLOGY_KIND, includeHidden: true }).map((entry) => [
        entry.slug,
        entry
      ])
    );
    const edges = detections
      .map((detection) => ({ detection, technology: technologies.get(detection.slug) }))
      .filter(
        (edge): edge is { detection: DetectedTechnology; technology: Entry } => !!edge.technology
      );

    await this.catalog.write((database) => {
      withLease(database, lease, () => {
        database
          .query(
            `DELETE FROM relations
             WHERE from_id = ? AND kind = 'uses' AND evidence = 'detected' AND provider = ?`
          )
          .run(projectId, TECH_SIGNATURES_PROVIDER);
        const insert = database.query(
          `INSERT INTO relations (
             id, from_id, to_id, kind, evidence, provider, attributes, note, created_at, updated_at
           ) VALUES (?, ?, ?, 'uses', 'detected', ?, ?, NULL, ?, ?)`
        );
        const timestamp = this.now();
        for (const { detection, technology } of edges)
          insert.run(
            relationId(projectId, technology.id, 'uses', 'detected'),
            projectId,
            technology.id,
            TECH_SIGNATURES_PROVIDER,
            JSON.stringify({
              version: detection.version,
              sourceFile: detection.sourceFile,
              matched: detection.matched
            }),
            timestamp,
            timestamp
          );
      });
    });
    return edges.length;
  }

  async removeRelation(id: string): Promise<void> {
    await this.catalog.write((database) => {
      const result = database.query('DELETE FROM relations WHERE id = ?').run(id);
      if (result.changes === 0) throw new Error(`Unknown relation ID: ${id}`);
    });
  }

  /* -------------------------------------------------------------- saved views */

  /** Built-in views and stored ones as one list; a stored view shadows a built-in of its name. */
  listSavedViews(): SavedView[] {
    return mergeSavedViews(this.listStoredViews());
  }

  listStoredViews(): SavedView[] {
    return this.database
      .query<Row, []>('SELECT * FROM saved_views ORDER BY position, name')
      .all()
      .map(viewFromRow);
  }

  getSavedView(idOrName: string): SavedView | null {
    return (
      this.listSavedViews().find((view) => view.id === idOrName || view.name === idOrName) ?? null
    );
  }

  async saveView(input: SavedViewInput): Promise<SavedView> {
    const view = validateSavedView(input as unknown as Record<string, unknown>);
    return this.catalog.write((database) => {
      const timestamp = this.now();
      const existing = database
        .query<Row, [string]>('SELECT * FROM saved_views WHERE name = ?')
        .get(view.name);
      const position =
        view.position ??
        (existing
          ? Number(existing.position)
          : Number(
              database
                .query<Row, []>('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM saved_views')
                .get()?.next ?? 1
            ));
      const id = existing
        ? String(existing.id)
        : `view_${createHash('sha256').update(view.name).digest('hex').slice(0, 24)}`;
      database
        .query(
          `INSERT INTO saved_views (id, name, kind, query, columns, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             kind = excluded.kind,
             query = excluded.query,
             columns = excluded.columns,
             position = excluded.position,
             updated_at = excluded.updated_at`
        )
        .run(
          id,
          view.name,
          view.kind ?? null,
          view.query ?? '',
          JSON.stringify(view.columns ?? []),
          position,
          timestamp,
          timestamp
        );
      const row = database
        .query<Row, [string]>('SELECT * FROM saved_views WHERE name = ?')
        .get(view.name);
      if (!row) throw new Error('Failed to persist saved view');
      return viewFromRow(row);
    });
  }

  async deleteSavedView(idOrName: string): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query('DELETE FROM saved_views WHERE id = ? OR name = ?')
        .run(idOrName, idOrName);
      if (result.changes === 0) {
        // A built-in view is declared in code, so there is no row to delete. Saving over it with
        // the same name is how a user changes what it selects.
        if (builtinSavedViews.some((view) => view.id === idOrName || view.name === idOrName))
          throw new SavedViewValidationError(
            `${idOrName} is a built-in view — save a view of the same name to change it`
          );
        throw new Error(`Unknown saved view: ${idOrName}`);
      }
    });
  }

  /* ----------------------------------------------- projects (entry projection) */

  /**
   * Discovery writes an entry and the filesystem provider's source row for it. The entry id stays
   * derived from the canonical path, so a project keeps its metrics, notes, and rank across scans.
   */
  async upsertDiscovered(project: DiscoveredProject, lease?: ScanLeaseOwnership): Promise<Project> {
    return this.catalog.write((database) => {
      const timestamp = this.now();
      const canonicalPath = resolve(project.canonicalPath);
      const id = stableProjectId(canonicalPath);
      const operation = () => {
        const existing = database
          .query<Row, [string]>('SELECT * FROM entries WHERE id = ?')
          .get(id);
        if (existing) {
          database
            .query('UPDATE entries SET name = ?, updated_at = ? WHERE id = ?')
            .run(project.name, timestamp, id);
        } else {
          const taken = database
            .query<{ slug: string }, []>("SELECT slug FROM entries WHERE kind = 'project'")
            .all()
            .map(({ slug }) => slug);
          database
            .query(
              `INSERT INTO entries (
                 id, kind, slug, name, note, tags, is_favorite, is_hidden, attributes,
                 created_at, updated_at
               ) VALUES (?, 'project', ?, ?, '', '[]', 0, 0, ?, ?, ?)`
            )
            .run(
              id,
              uniqueSlug(slugify(project.name), taken),
              project.name,
              JSON.stringify({ manual_rank: nextManualRank(database) }),
              timestamp,
              timestamp
            );
        }
        database
          .query(
            `INSERT INTO entry_sources (
               entry_id, provider, locator, metadata, first_seen_at, last_seen_at, missing_since
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(entry_id, provider) DO UPDATE SET
               locator = excluded.locator,
               metadata = excluded.metadata,
               last_seen_at = excluded.last_seen_at,
               missing_since = NULL`
          )
          .run(
            id,
            FILESYSTEM_PROVIDER,
            canonicalPath,
            JSON.stringify({
              relativePath: project.relativePath,
              scanRoot: resolve(project.scanRoot)
            }),
            timestamp,
            timestamp
          );
        return this.readProject(database, id);
      };
      const found = withLease(database, lease, operation);
      if (!found) throw new Error('Failed to persist discovered project');
      return found;
    });
  }

  /**
   * A project entry a hosting provider found that has no local checkout. It is written exactly the
   * way {@link upsertDiscovered} writes a local one — an entry plus one `entry_sources` row — except
   * that the source is the provider's own and the locator is `owner/name` rather than a path. The
   * read model therefore says "no path", the attention rules see no metrics they can trust, and
   * nothing else in the catalog needs to know this entry is different.
   */
  async upsertRemoteProject(
    input: { provider: string; locator: string; name: string; metadata?: Record<string, unknown> },
    lease?: ScanLeaseOwnership
  ): Promise<Entry> {
    return this.catalog.write((database) => {
      const timestamp = this.now();
      const id = stableRemoteId(input.provider, input.locator);
      const operation = () => {
        const existing = database
          .query<Row, [string]>('SELECT * FROM entries WHERE id = ?')
          .get(id);
        if (!existing) {
          const taken = database
            .query<{ slug: string }, []>("SELECT slug FROM entries WHERE kind = 'project'")
            .all()
            .map(({ slug }) => slug);
          database
            .query(
              `INSERT INTO entries (
                 id, kind, slug, name, note, tags, is_favorite, is_hidden, attributes,
                 created_at, updated_at
               ) VALUES (?, 'project', ?, ?, '', '[]', 0, 0, ?, ?, ?)`
            )
            .run(
              id,
              uniqueSlug(slugify(input.name), taken),
              input.name,
              JSON.stringify({ manual_rank: nextManualRank(database) }),
              timestamp,
              timestamp
            );
        }
        database
          .query(
            `INSERT INTO entry_sources (
               entry_id, provider, locator, metadata, first_seen_at, last_seen_at, missing_since
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(entry_id, provider) DO UPDATE SET
               locator = excluded.locator,
               metadata = excluded.metadata,
               last_seen_at = excluded.last_seen_at,
               missing_since = NULL`
          )
          .run(
            id,
            input.provider,
            input.locator,
            JSON.stringify(input.metadata ?? {}),
            timestamp,
            timestamp
          );
        const row = database.query<Row, [string]>('SELECT * FROM entries WHERE id = ?').get(id);
        if (!row) throw new Error('Failed to persist remote project');
        return entryFromRow(row);
      };
      return withLease(database, lease, operation);
    });
  }

  /**
   * Project entries whose only source is `provider` — the remote-only ones. An entry that also has
   * a filesystem source is a local checkout and belongs to discovery, not here.
   */
  listRemoteProjects(provider: string): { entry: Entry; locator: string }[] {
    const local = new Set(this.listAllSources(FILESYSTEM_PROVIDER).keys());
    const remote: { entry: Entry; locator: string }[] = [];
    for (const [entryId, sources] of this.listAllSources(provider)) {
      if (local.has(entryId)) continue;
      const entry = this.getEntry(entryId);
      if (!entry || entry.kind !== 'project') continue;
      remote.push({ entry, locator: sources[0].locator });
    }
    return remote.sort((left, right) => left.locator.localeCompare(right.locator, 'en'));
  }

  private readProject(database: Database, id: string): Project | null {
    const row = database.query<Row, [string]>('SELECT * FROM entries WHERE id = ?').get(id);
    if (!row) return null;
    const entry = entryFromRow(row);
    if (entry.kind !== 'project') return null;
    const sourceRow = database
      .query<Row, [string, string]>(
        'SELECT * FROM entry_sources WHERE entry_id = ? AND provider = ?'
      )
      .get(id, FILESYSTEM_PROVIDER);
    // A project entry with no filesystem source has no path to open, scan, or forget. Phase 5's
    // remote-only entries get their own projection rather than pretending to be local checkouts.
    return sourceRow ? projectFromEntry(entry, sourceFromRow(sourceRow)) : null;
  }

  getProject(id: string): Project | null {
    return this.readProject(this.database, id);
  }

  listProjects(options: { includeHidden?: boolean } = {}): Project[] {
    const sources = this.listAllSources(FILESYSTEM_PROVIDER);
    return this.listEntries({ kind: 'project', includeHidden: options.includeHidden })
      .map((entry) => {
        const source = sources.get(entry.id)?.[0];
        return source ? projectFromEntry(entry, source) : null;
      })
      .filter((project): project is Project => project !== null);
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.updateEntryFlag(id, 'is_favorite', favorite);
  }

  async setHidden(id: string, hidden: boolean): Promise<void> {
    await this.updateEntryFlag(id, 'is_hidden', hidden);
  }

  /** Missing is the filesystem provider's verdict, so it is written on the source, not the entry. */
  async setMissing(id: string, missing: boolean): Promise<void> {
    await this.catalog.write((database) => {
      const timestamp = this.now();
      const result = database
        .query(
          `UPDATE entry_sources
              SET missing_since = CASE WHEN ? THEN COALESCE(missing_since, ?) ELSE NULL END
            WHERE entry_id = ? AND provider = ?`
        )
        .run(missing ? 1 : 0, timestamp, id, FILESYSTEM_PROVIDER);
      requireChanged(result.changes, id);
      database.query('UPDATE entries SET updated_at = ? WHERE id = ?').run(timestamp, id);
    });
  }

  private async updateEntryFlag(
    id: string,
    column: 'is_favorite' | 'is_hidden',
    value: boolean
  ): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query(`UPDATE entries SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .run(value ? 1 : 0, this.now(), id);
      requireChanged(result.changes, id);
    });
  }

  async updateNote(id: string, note: string): Promise<void> {
    validateProjectNote(note);
    if (!this.getEntry(id)) throw new Error(`Unknown project ID: ${id}`);
    await this.patchEntry(id, { note });
  }

  async updateWebsite(id: string, patch: unknown): Promise<ProjectWebsite> {
    return this.catalog.write((database) => {
      const entry = this.getEntry(id);
      if (!entry) throw new Error(`Unknown project ID: ${id}`);
      const website = updateWebsite(entry.website ?? null, patch);
      if (
        this.listEntries({ includeHidden: true }).some(
          (other) => other.id !== id && other.website?.slug === website.slug
        )
      )
        throw new Error(`Website slug already used: ${website.slug}`);
      if (this.listWebsitePages().some((page) => page.slug === website.slug))
        throw new Error(`Website slug already used: ${website.slug}`);
      database
        .query('UPDATE entries SET website_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(website), this.now(), id);
      return website;
    });
  }

  listWebsitePages(): ProjectWebsite[] {
    return this.database
      .query<{ website_json: string }, []>('SELECT website_json FROM website_pages ORDER BY slug')
      .all()
      .map((row) => JSON.parse(row.website_json) as ProjectWebsite);
  }

  getWebsitePage(slug: string): ProjectWebsite | null {
    return this.listWebsitePages().find((page) => page.slug === slug) ?? null;
  }

  async updateWebsitePage(slug: string, patch: unknown): Promise<ProjectWebsite> {
    return this.catalog.write((database) => {
      const website = updateWebsite(this.getWebsitePage(slug), patch);
      if (website.slug !== slug) throw new Error('Page slug must match its URL identifier');
      if (this.listEntries({ includeHidden: true }).some((entry) => entry.website?.slug === slug))
        throw new Error(`Website slug already used: ${slug}`);
      database
        .query(
          'INSERT INTO website_pages (slug, website_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET website_json = excluded.website_json, updated_at = excluded.updated_at'
        )
        .run(slug, JSON.stringify(website), this.now());
      return website;
    });
  }

  /** The dashboard's decision edit, expressed as a field patch so validation has one home. */
  async updateDecision(id: string, update: ProjectDecisionUpdate): Promise<void> {
    validateDecisionUpdate(update);
    const keys: Record<keyof ProjectDecisionUpdate, string> = {
      intent: 'intent',
      excitement: 'excitement',
      strategicImportance: 'strategic_importance',
      nextAction: 'next_action',
      reviewAfter: 'review_after'
    };
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(update))
      if (value !== undefined) patch[keys[key as keyof ProjectDecisionUpdate]] = value;
    if (!Object.keys(patch).length) return;
    if (!this.getEntry(id)) throw new Error(`Unknown project ID: ${id}`);
    await this.patchEntry(id, patch);
  }

  /**
   * Drops an entry entirely. Sources, metrics, snapshots, stacks, relations, and collection errors
   * follow via ON DELETE CASCADE, so nothing is left keyed to an entry that no longer exists.
   */
  async forgetProject(id: string): Promise<void> {
    await this.deleteEntry(id);
  }

  /** Bulk form of {@link forgetProject}; returns the ids that were actually removed. */
  async forgetProjects(ids: readonly string[], lease?: ScanLeaseOwnership): Promise<string[]> {
    if (ids.length === 0) return [];
    return this.catalog.write((database) => {
      const forgotten: string[] = [];
      const operation = () => {
        const statement = database.query('DELETE FROM entries WHERE id = ?');
        for (const id of ids) if (statement.run(id).changes > 0) forgotten.push(id);
      };
      withLease(database, lease, operation);
      return forgotten;
    });
  }

  async markUnseenMissing(
    scanRoots: readonly string[],
    seenProjectIds: readonly string[],
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      const seen = new Set(seenProjectIds);
      const roots = new Set(scanRoots.map((root) => resolve(root)));
      const operation = () => {
        const timestamp = this.now();
        const update = database.query(
          // COALESCE keeps the original timestamp: missing_since marks when a source first stopped
          // finding the entry, not when it was last observed missing, so the grace period elapses.
          `UPDATE entry_sources
              SET missing_since = COALESCE(missing_since, ?)
            WHERE entry_id = ? AND provider = ?`
        );
        const touch = database.query('UPDATE entries SET updated_at = ? WHERE id = ?');
        for (const [entryId, sources] of this.listAllSources(FILESYSTEM_PROVIDER)) {
          if (seen.has(entryId)) continue;
          const scanRoot = sources[0]?.metadata.scanRoot;
          if (typeof scanRoot !== 'string' || !roots.has(scanRoot)) continue;
          update.run(timestamp, entryId, FILESYSTEM_PROVIDER);
          touch.run(timestamp, entryId);
        }
      };
      withLease(database, lease, operation);
    });
  }

  async reorderVisibleProjects(orderedIds: readonly string[]): Promise<void> {
    await this.catalog.write((database) => {
      const transaction = database.transaction(() => {
        const expectedIds = this.listEntries({ kind: 'project' }).map(({ id }) => id);
        const ranks = assignManualRanks(orderedIds, expectedIds);
        const update = database.query(
          'UPDATE entries SET attributes = ?, updated_at = ? WHERE id = ?'
        );
        const timestamp = this.now();
        for (const [id, rank] of ranks) {
          const entry = this.getEntry(id);
          if (!entry) continue;
          update.run(JSON.stringify({ ...entry.attributes, manual_rank: rank }), timestamp, id);
        }
      });
      transaction.immediate();
    });
  }

  /* ------------------------------------------------------- provider metrics */

  getMetrics(projectId: string): ProjectMetrics | null {
    const row = this.database
      .query<Row, [string]>('SELECT * FROM project_metrics WHERE entry_id = ?')
      .get(projectId);
    return row ? metricsFromRow(row) : null;
  }

  async updateMetrics(
    projectId: string,
    update: ProjectMetricsUpdate,
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    const entries = Object.entries(update).filter(([, value]) => value !== undefined) as [
      keyof ProjectMetricsUpdate,
      Exclude<ProjectMetricsUpdate[keyof ProjectMetricsUpdate], undefined>
    ][];
    if (entries.length === 0) return;
    await this.catalog.write((database) => {
      withLease(database, lease, () => {
        if (!entryExists(database, projectId)) throw new Error(`Unknown project ID: ${projectId}`);
        database
          .query(
            'INSERT INTO project_metrics (entry_id) VALUES (?) ON CONFLICT(entry_id) DO NOTHING'
          )
          .run(projectId);
        const assignments = entries.map(([key]) => `${metricColumns[key]} = ?`).join(', ');
        const values: SQLQueryBindings[] = entries.map(([, value]) =>
          typeof value === 'boolean' ? (value ? 1 : 0) : value
        );
        database
          .query(`UPDATE project_metrics SET ${assignments} WHERE entry_id = ?`)
          .run(...values, projectId);
      });
    });
  }

  async saveSnapshot(snapshot: MetricSnapshot, lease?: ScanLeaseOwnership): Promise<void> {
    await this.catalog.write((database) => {
      // Same race as recordCollectionError: the project may have been forgotten mid-scan.
      if (!entryExists(database, snapshot.projectId)) return;
      withLease(database, lease, () =>
        database
          .query(
            `
        INSERT INTO metric_snapshots (entry_id, metric, captured_on, value)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id, metric, captured_on) DO UPDATE SET value = excluded.value
      `
          )
          .run(snapshot.projectId, snapshot.metric, snapshot.capturedOn, snapshot.value)
      );
    });
  }

  listSnapshots(projectId: string, metric?: SnapshotMetric): MetricSnapshot[] {
    const rows = metric
      ? this.database
          .query<Row, [string, string]>(
            'SELECT * FROM metric_snapshots WHERE entry_id = ? AND metric = ? ORDER BY captured_on'
          )
          .all(projectId, metric)
      : this.database
          .query<Row, [string]>(
            'SELECT * FROM metric_snapshots WHERE entry_id = ? ORDER BY metric, captured_on'
          )
          .all(projectId);
    return rows.map((row) => ({
      projectId: String(row.entry_id),
      metric: String(row.metric) as SnapshotMetric,
      capturedOn: String(row.captured_on),
      value: Number(row.value)
    }));
  }

  /**
   * Replace a project's declarations wholesale, so a manifest that stopped declaring a toolchain
   * stops reporting one. Delete and insert share a transaction to keep readers from seeing a gap.
   */
  async replaceProjectStacks(
    projectId: string,
    stacks: readonly DeclaredStack[],
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      withLease(database, lease, () => {
        if (!entryExists(database, projectId)) throw new Error(`Unknown project ID: ${projectId}`);
        database.query('DELETE FROM project_stacks WHERE entry_id = ?').run(projectId);
        const insert = database.query(
          `INSERT INTO project_stacks (entry_id, toolchain, declared, raw, source_file)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(entry_id, toolchain, source_file) DO UPDATE SET
             declared = excluded.declared, raw = excluded.raw`
        );
        for (const stack of stacks)
          insert.run(projectId, stack.toolchain, stack.declared, stack.raw, stack.sourceFile);
      });
    });
  }

  listProjectStacks(projectId: string): DeclaredStack[] {
    return this.database
      .query<Row, [string]>(
        'SELECT * FROM project_stacks WHERE entry_id = ? ORDER BY toolchain, source_file'
      )
      .all(projectId)
      .map(stackFromRow);
  }

  /** Every declaration in the catalog, grouped by project, so a catalog read avoids N queries. */
  listAllProjectStacks(): Map<string, DeclaredStack[]> {
    const grouped = new Map<string, DeclaredStack[]>();
    for (const row of this.database
      .query<Row, []>('SELECT * FROM project_stacks ORDER BY toolchain, source_file')
      .all()) {
      const projectId = String(row.entry_id);
      const stacks = grouped.get(projectId) ?? [];
      stacks.push(stackFromRow(row));
      grouped.set(projectId, stacks);
    }
    return grouped;
  }

  /** Replace one toolchain's cached cycles and record the refresh outcome in the same transaction. */
  async replaceToolchainReleases(
    status: ToolchainBaselineStatus,
    releases: readonly ToolchainReleaseCycle[],
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      withLease(database, lease, () => {
        // A failed refresh keeps the cached cycles; only the status row changes.
        if (status.availability === 'available') {
          database
            .query('DELETE FROM toolchain_releases WHERE toolchain = ?')
            .run(status.toolchain);
          const insert = database.query(
            `INSERT INTO toolchain_releases (
               toolchain, cycle, latest, release_date, eol_from, is_eol, is_maintained, is_lts, fetched_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const release of releases)
            insert.run(
              status.toolchain,
              release.cycle,
              release.latest,
              release.releaseDate,
              release.eolFrom,
              release.isEol ? 1 : 0,
              release.isMaintained ? 1 : 0,
              release.isLts ? 1 : 0,
              status.fetchedAt
            );
        }
        database
          .query(
            `INSERT INTO toolchain_baseline_status (toolchain, availability, fetched_at, message)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(toolchain) DO UPDATE SET
               availability = excluded.availability,
               fetched_at = excluded.fetched_at,
               message = excluded.message`
          )
          .run(status.toolchain, status.availability, status.fetchedAt, status.message);
      });
    });
  }

  listToolchainReleases(): Map<Toolchain, ToolchainRelease[]> {
    const grouped = new Map<Toolchain, ToolchainRelease[]>();
    for (const row of this.database
      .query<Row, []>('SELECT * FROM toolchain_releases ORDER BY toolchain, cycle')
      .all()) {
      const toolchain = String(row.toolchain) as Toolchain;
      const releases = grouped.get(toolchain) ?? [];
      releases.push({
        toolchain,
        cycle: String(row.cycle),
        latest: row.latest === null ? null : String(row.latest),
        releaseDate: row.release_date === null ? null : String(row.release_date),
        eolFrom: row.eol_from === null ? null : String(row.eol_from),
        isEol: bool(row.is_eol),
        isMaintained: bool(row.is_maintained),
        isLts: bool(row.is_lts),
        fetchedAt: String(row.fetched_at)
      });
      grouped.set(toolchain, releases);
    }
    return grouped;
  }

  listBaselineStatus(): ToolchainBaselineStatus[] {
    return this.database
      .query<Row, []>('SELECT * FROM toolchain_baseline_status ORDER BY toolchain')
      .all()
      .map((row) => ({
        toolchain: String(row.toolchain) as Toolchain,
        availability: String(row.availability) as ToolchainBaselineStatus['availability'],
        fetchedAt: String(row.fetched_at),
        message: row.message === null ? null : String(row.message)
      }));
  }

  async recordCollectionError(
    error: Omit<CollectionError, 'resolvedAt'>,
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      // A project can be forgotten while a scan is still collecting for it. Recording an error
      // against the deleted row would raise a foreign-key violation from inside the scanner's own
      // error handler and fail the entire run, so drop the error with the project.
      if (!entryExists(database, error.projectId)) return;
      withLease(database, lease, () =>
        database
          .query(
            `
        INSERT INTO collection_errors (entry_id, collector, message, occurred_at, resolved_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(entry_id, collector) DO UPDATE SET
          message = excluded.message, occurred_at = excluded.occurred_at, resolved_at = NULL
      `
          )
          .run(error.projectId, error.collector, error.message, error.occurredAt)
      );
    });
  }

  async resolveCollectionError(
    projectId: string,
    collector: Collector,
    resolvedAt = this.now(),
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      withLease(database, lease, () =>
        database
          .query(
            'UPDATE collection_errors SET resolved_at = ? WHERE entry_id = ? AND collector = ?'
          )
          .run(resolvedAt, projectId, collector)
      );
    });
  }

  listCollectionErrors(projectId: string, activeOnly = false): CollectionError[] {
    const sql = `SELECT * FROM collection_errors WHERE entry_id = ?${activeOnly ? ' AND resolved_at IS NULL' : ''} ORDER BY occurred_at`;
    return this.database
      .query<Row, [string]>(sql)
      .all(projectId)
      .map((row) => ({
        projectId: String(row.entry_id),
        collector: String(row.collector) as Collector,
        message: String(row.message),
        occurredAt: String(row.occurred_at),
        resolvedAt: row.resolved_at === null ? null : String(row.resolved_at)
      }));
  }

  /* ---------------------------------------------------------------- scan runs */

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

  /**
   * Atomically recovers expired owners, then acquires the catalog-wide scan lease.
   * Rows without lease metadata predate lease support and are safe to recover after upgrade.
   */
  async tryCreateScanRun(
    run: ScanRun,
    lease: { owner: string; heartbeatAt: string; staleBefore: string }
  ): Promise<boolean> {
    return this.catalog.write((database) => {
      const transaction = database.transaction(() => {
        database
          .query(
            `UPDATE scan_runs
             SET status = 'cancelled', finished_at = ?
             WHERE status = 'running'
               AND (lease_owner IS NULL OR heartbeat_at IS NULL OR heartbeat_at < ?)`
          )
          .run(lease.heartbeatAt, lease.staleBefore);
        const active = database
          .query<{ id: string }, []>("SELECT id FROM scan_runs WHERE status = 'running' LIMIT 1")
          .get();
        if (active) return false;
        database
          .query(
            `
          INSERT INTO scan_runs (
            id, reason, status, started_at, finished_at, discovered_count, updated_count,
            error_count, lease_owner, heartbeat_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            run.errorCount,
            lease.owner,
            lease.heartbeatAt
          );
        return true;
      });
      return transaction.immediate();
    });
  }

  async renewScanLease(id: string, owner: string, heartbeatAt: string): Promise<boolean> {
    return this.catalog.write(
      (database) =>
        database
          .query(
            `UPDATE scan_runs SET heartbeat_at = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
          )
          .run(heartbeatAt, id, owner).changes > 0
    );
  }

  async updateScanRunProgress(
    id: string,
    counts: Pick<ScanRun, 'discoveredCount' | 'updatedCount' | 'errorCount'>,
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query(
          `UPDATE scan_runs SET discovered_count = ?, updated_count = ?, error_count = ?
           WHERE id = ? AND status = 'running'${lease ? ' AND lease_owner = ?' : ''}`
        )
        .run(
          counts.discoveredCount,
          counts.updatedCount,
          counts.errorCount,
          id,
          ...(lease ? [lease.owner] : [])
        );
      if (result.changes === 0) {
        if (lease) throw new ScanLeaseLostError(id);
        throw new Error(`Unknown or already finished scan run: ${id}`);
      }
    });
  }

  async finishScanRun(
    id: string,
    status: Exclude<ScanStatus, 'running'>,
    counts: Pick<ScanRun, 'discoveredCount' | 'updatedCount' | 'errorCount'>,
    finishedAt = this.now(),
    lease?: ScanLeaseOwnership
  ): Promise<void> {
    await this.catalog.write((database) => {
      const result = database
        .query(
          `
        UPDATE scan_runs SET status = ?, finished_at = ?, discovered_count = ?, updated_count = ?, error_count = ?
        WHERE id = ? AND status = 'running'${lease ? ' AND lease_owner = ?' : ''}
      `
        )
        .run(
          status,
          finishedAt,
          counts.discoveredCount,
          counts.updatedCount,
          counts.errorCount,
          id,
          ...(lease ? [lease.owner] : [])
        );
      if (result.changes === 0) {
        if (lease) throw new ScanLeaseLostError(id);
        throw new Error(`Unknown or already finished scan run: ${id}`);
      }
    });
  }

  getScanRun(id: string): ScanRun | null {
    const row = this.database.query<Row, [string]>('SELECT * FROM scan_runs WHERE id = ?').get(id);
    return row ? scanRunFromRow(row) : null;
  }

  getActiveScanRun(): ScanRun | null {
    const row = this.database
      .query<Row, []>(
        "SELECT * FROM scan_runs WHERE status = 'running' ORDER BY started_at LIMIT 1"
      )
      .get();
    return row ? { ...scanRunFromRow(row), finishedAt: null } : null;
  }

  getLatestScanRun(): ScanRun | null {
    const row = this.database
      .query<Row, []>('SELECT * FROM scan_runs ORDER BY started_at DESC, id DESC LIMIT 1')
      .get();
    return row ? scanRunFromRow(row) : null;
  }

  /* ----------------------------------------------------------- provider runs */

  /**
   * What a provider did on the last scan that considered it. A skipped provider records a row too:
   * "nothing happened, and here is why" is the answer `ongoing providers` exists to give.
   */
  async recordProviderRun(run: ProviderRun): Promise<void> {
    await this.catalog.write((database) =>
      database
        .query(
          `INSERT INTO provider_runs (provider, status, last_run_at, run_id, detail)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET
             status = excluded.status,
             last_run_at = excluded.last_run_at,
             run_id = excluded.run_id,
             detail = excluded.detail`
        )
        .run(run.provider, run.status, run.lastRunAt, run.runId ?? null, run.detail ?? null)
    );
  }

  listProviderRuns(): ProviderRun[] {
    return this.database
      .query<Row, []>('SELECT * FROM provider_runs ORDER BY provider')
      .all()
      .map((row) => ({
        provider: String(row.provider),
        status: String(row.status) as ProviderRunStatus,
        lastRunAt: String(row.last_run_at),
        runId: row.run_id === null ? null : String(row.run_id),
        detail: row.detail === null ? null : String(row.detail)
      }));
  }
}

function manualRank(entry: Entry): number {
  const value = entry.attributes.manual_rank;
  return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
}

/** Sparse ranks in steps of 1000, computed in the read model rather than with a JSON1 expression. */
function nextManualRank(database: Database): number {
  const rows = database.query<Row, []>('SELECT attributes FROM entries').all();
  let highest = 0;
  for (const row of rows) {
    const value = parseObject(row.attributes).manual_rank;
    if (typeof value === 'number' && value > highest) highest = value;
  }
  return highest + 1_000;
}

function stackFromRow(row: Row): DeclaredStack {
  return {
    toolchain: String(row.toolchain) as Toolchain,
    declared: String(row.declared),
    raw: String(row.raw),
    sourceFile: String(row.source_file)
  };
}

function scanRunFromRow(row: Row): ScanRun {
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

function metricsFromRow(row: Row): ProjectMetrics {
  const number = (key: string): number | null => (row[key] === null ? null : Number(row[key]));
  const string = (key: string): string | null => (row[key] === null ? null : String(row[key]));
  return {
    projectId: String(row.entry_id),
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
    stackScannedAt: string('stack_scanned_at'),
    tdScannedAt: string('td_scanned_at'),
    githubScannedAt: string('github_scanned_at'),
    githubTrafficScannedAt: string('github_traffic_scanned_at')
  };
}
