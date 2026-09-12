import { attentionViewKeys } from './attention';
import type { AttributeValue } from './entry';
import type { FieldDefinition, FieldType } from './fields';
import type { ProjectMetrics } from './metrics';
import { toolchainKeys, type DeclaredStack } from './stack';

/**
 * Provider-collected data stays in its own typed tables and is **projected** into namespaced,
 * read-only fields by the read model, so filtering and sorting cannot tell a provider field apart
 * from a stored one (ADR 0005). Nothing here writes; `storage: 'projected'` makes the registry
 * refuse a patch that targets one.
 */
interface ProjectedField {
  key: string;
  provider: string;
  type: FieldType;
  label: string;
  /** Reads the value out of the metric row. */
  read: (metrics: ProjectMetrics | null) => AttributeValue;
}

function metric(
  key: string,
  provider: string,
  type: FieldType,
  label: string,
  read: (metrics: ProjectMetrics) => AttributeValue
): ProjectedField {
  return { key, provider, type, label, read: (metrics) => (metrics ? read(metrics) : null) };
}

const projectedMetrics: readonly ProjectedField[] = [
  metric('git.branch', 'git', 'text', 'Branch', (m) => m.branch),
  metric('git.latestCommit', 'git', 'text', 'Latest commit', (m) => m.latestCommitAt),
  metric('git.commits7d', 'git', 'integer', 'Commits (7d)', (m) => m.commits7d),
  metric('git.commits30d', 'git', 'integer', 'Commits (30d)', (m) => m.commits30d),
  metric('git.commits90d', 'git', 'integer', 'Commits (90d)', (m) => m.commits90d),
  metric('git.commitCount', 'git', 'integer', 'Commits (lifetime)', (m) => m.commitCount),
  metric('git.dirtyFiles', 'git', 'integer', 'Dirty files', (m) => m.dirtyFiles),
  metric('git.ahead', 'git', 'integer', 'Commits ahead', (m) => m.aheadCount),
  metric('git.behind', 'git', 'integer', 'Commits behind', (m) => m.behindCount),
  metric('git.latestTag', 'git', 'text', 'Latest tag', (m) => m.latestTag),
  metric('loc.code', 'loc', 'integer', 'Lines of code', (m) => m.locCode),
  metric('loc.files', 'loc', 'integer', 'Files', (m) => m.locFiles),
  metric('loc.test', 'loc', 'integer', 'Test lines', (m) => m.locTest),
  metric('loc.language', 'loc', 'text', 'Dominant language', (m) => m.dominantLanguage),
  metric('td.open', 'td', 'integer', 'Open issues', (m) => m.tdOpenCount),
  metric('td.inProgress', 'td', 'integer', 'In progress', (m) => m.tdInProgressCount),
  metric('td.blocked', 'td', 'integer', 'Blocked', (m) => m.tdBlockedCount),
  metric('td.review', 'td', 'integer', 'In review', (m) => m.tdReviewCount),
  metric('td.stale', 'td', 'integer', 'Stale', (m) => m.tdStaleCount),
  metric('td.total', 'td', 'integer', 'Not closed', (m) => m.tdTotalNonClosedCount),
  metric('git.activeDays30d', 'git', 'integer', 'Active days (30d)', (m) => m.activeDays30d),
  metric('github.repoId', 'github', 'text', 'GitHub repository id', (m) => m.githubRepoId),
  metric(
    'github.oldestExternalPr',
    'github',
    'text',
    'Oldest external PR',
    (m) => m.githubOldestExternalPrAt
  ),
  metric('github.owner', 'github', 'text', 'GitHub owner', (m) => m.githubOwner),
  metric('github.name', 'github', 'text', 'GitHub name', (m) => m.githubName),
  metric('github.visibility', 'github', 'text', 'Visibility', (m) => m.githubVisibility),
  metric('github.isArchived', 'github', 'boolean', 'Archived', (m) => m.githubIsArchived),
  metric('github.stars', 'github', 'integer', 'Stars', (m) => m.githubStars),
  metric('github.forks', 'github', 'integer', 'Forks', (m) => m.githubForks),
  metric('github.watchers', 'github', 'integer', 'Watchers', (m) => m.githubWatchers),
  metric('github.openIssues', 'github', 'integer', 'Open issues', (m) => m.githubOpenIssues),
  metric('github.openPrs', 'github', 'integer', 'Open pull requests', (m) => m.githubOpenPrs),
  metric('github.externalPrs', 'github', 'integer', 'External PRs', (m) => m.githubExternalPrs),
  metric('github.ciState', 'github', 'text', 'CI state', (m) => m.githubCiState),
  metric(
    'github.latestRelease',
    'github',
    'text',
    'Latest release',
    (m) => m.githubLatestReleaseTag
  ),
  metric('github.trafficViews', 'github', 'integer', 'Traffic views', (m) => m.githubTrafficViews)
];

function projected(
  key: string,
  provider: string,
  type: FieldType,
  label: string,
  extra: Partial<FieldDefinition> = {}
): FieldDefinition {
  return {
    key,
    kinds: ['project'],
    type,
    owner: `provider:${provider}`,
    label,
    sortable: true,
    filterable: true,
    editable: false,
    required: false,
    storage: 'projected',
    ...extra
  };
}

/**
 * Fields a provider contributes that the read model *derives* rather than reads out of a metric
 * row: a filesystem source's path, the largest toolchain lag, a snapshot delta. They are projected
 * like any other provider field so the query grammar cannot tell them apart from stored ones, and
 * so `--filter missing`, `--view`, `--stack`, and `tech:` all become ordinary clauses rather than
 * special cases in the evaluator. They are declared here and claimed by a manifest in `provider.ts`.
 */
const derivedProviderFields: readonly FieldDefinition[] = [
  projected('path', 'filesystem', 'text', 'Path', {
    description: 'Where the filesystem provider found this entry'
  }),
  projected('is_missing', 'filesystem', 'boolean', 'Missing', {
    description: 'The directory this entry was discovered in is gone'
  }),
  projected('stack.lag', 'stack', 'integer', 'Stack lag', {
    description: 'Largest number of release cycles any declared toolchain is behind'
  }),
  projected('github.starsGained30d', 'github', 'integer', 'Stars gained (30d)'),
  projected('github.trafficViewsDelta30d', 'github', 'integer', 'Traffic change (30d)')
];

/**
 * Fields the catalog derives from itself rather than from a provider: the attention classification,
 * the collector warning count, and the relation roll-ups. They are registered whether or not any
 * provider is enabled, because an edge and a ring are catalog facts rather than measurements — the
 * same reasoning that keeps the two radar attention reasons outside the freshness gate (Phase 3).
 */
export const catalogDerivedFields: readonly FieldDefinition[] = [
  projected('views', 'attention', 'multi_enum', 'Attention views', {
    options: { values: attentionViewKeys },
    sortable: false,
    description: 'Attention views this entry currently belongs to; `view:` is its alias'
  }),
  projected('warnings', 'collector', 'integer', 'Collector warnings', {
    description: 'Unresolved collection errors on this entry'
  }),
  projected('tech', 'relations', 'multi_enum', 'Technologies', {
    kinds: ['*'],
    sortable: false,
    description: 'Slugs of the technologies this entry uses or provides'
  }),
  projected('used_by', 'relations', 'integer', 'Projects using it', {
    kinds: ['technology'],
    description: 'How many projects hold a `uses` edge to this technology'
  }),
  projected('provided_by', 'relations', 'text', 'Provided by', {
    kinds: ['technology'],
    description: 'Slug of the managed project that supplies this technology'
  }),
  projected('ring_stale', 'radar', 'boolean', 'Ring is stale', {
    kinds: ['technology'],
    description: '`review_after` has passed, so the ring describes a moment that is over'
  })
];

/** `stack.go`, `stack.bun`, … — the declared version of each toolchain a project uses. */
const stackFields: readonly FieldDefinition[] = toolchainKeys.map((toolchain) =>
  projected(`stack.${toolchain}`, 'stack', 'text', `${toolchain} version`)
);

/** Every projected field, tagged with the provider that owns it. */
const allProjectedFields: readonly FieldDefinition[] = [
  ...projectedMetrics.map((field) => projected(field.key, field.provider, field.type, field.label)),
  ...stackFields,
  ...derivedProviderFields
];

/**
 * The fields one provider contributes. `provider.ts` calls this to fill in each manifest's `fields`,
 * which is what makes the manifest — rather than a hand-maintained table — the place a provider's
 * contribution is declared (ADR 0007).
 */
export function projectedFieldsFor(provider: string): FieldDefinition[] {
  return allProjectedFields.filter((field) => field.owner === `provider:${provider}`);
}

/**
 * The read model's projection: a metric row and a project's declarations become namespaced field
 * values. Keys with no value are omitted rather than set to null, so "has a value" stays a simple
 * membership test.
 */
export function projectProviderFields(
  metrics: ProjectMetrics | null,
  stacks: readonly DeclaredStack[] = []
): Record<string, AttributeValue> {
  const values: Record<string, AttributeValue> = {};
  for (const field of projectedMetrics) {
    const value = field.read(metrics);
    if (value !== null && value !== undefined) values[field.key] = value;
  }
  for (const stack of stacks)
    if (stack.declared) values[`stack.${stack.toolchain}`] = stack.declared;
  return values;
}
