import {
  attentionViewKeys,
  classifyAttentionViews,
  type AttentionClassifications
} from '$lib/domain/attention';
import { entryCompleteness, storedFields } from '$lib/domain/completeness';
import type { AttributeValue, Entry, EntrySource } from '$lib/domain/entry';
import type { EntryView, RelationView } from '$lib/domain/entry-view';
import type { FieldRegistry } from '$lib/domain/fields';
import { metricDelta30d, type CollectionError, type ProjectMetrics } from '$lib/domain/metrics';
import type { ProjectIntent } from '$lib/domain/project';
import { projectProviderFields } from '$lib/domain/provider-fields';
import type { Relation } from '$lib/domain/relation';
import {
  isRingStale,
  sortUsedTechnologies,
  TECHNOLOGY_KIND,
  usedTechnology,
  type UsedTechnology
} from '$lib/domain/technology';
import {
  resolveStack,
  stackLag,
  type DeclaredStack,
  type ResolvedStack,
  type Toolchain,
  type ToolchainRelease
} from '$lib/domain/stack';
import type { CatalogRepository } from './repository';

/**
 * The read model. Stored attributes, provider metrics, and derived values are merged into one flat
 * `fields` map, so a caller — the API, the CLI, and the query evaluator — cannot tell a projected
 * provider value from a stored one, and nothing outside this file knows the storage layout.
 */
export type { EntryView, RelationView } from '$lib/domain/entry-view';

const FILESYSTEM_PROVIDER = 'filesystem';

/** Relation kinds that put a technology into an entry's `tech` field. */
const TECH_RELATION_KINDS = ['uses', 'provides'];

const columnFields = storedFields;

interface Derived {
  path: string | null;
  isMissing: boolean;
  views: string[];
  attention: AttentionClassifications | null;
  metrics: ProjectMetrics | null;
  stacks: ResolvedStack[];
  errors: CollectionError[];
  technologies: UsedTechnology[];
  fields: Record<string, AttributeValue>;
}

/**
 * The technologies behind a project's `uses` edges, with the version the edge carries and the ring
 * the technology entry carries. Resolving them here is what lets the attention rules stay pure and
 * lets the browser re-run them after an optimistic edit.
 */
function usedTechnologies(
  relations: { outgoing: RelationView[] },
  entries: ReadonlyMap<string, Entry>
): UsedTechnology[] {
  const used: UsedTechnology[] = [];
  for (const relation of relations.outgoing) {
    if (relation.kind !== 'uses') continue;
    const technology = relation.other ? entries.get(relation.other.id) : undefined;
    if (!technology || technology.kind !== TECHNOLOGY_KIND) continue;
    used.push(usedTechnology(technology, relation));
  }
  return sortUsedTechnologies(used);
}

/** `used_by`, `provided_by`, and `ring_stale` — what a technology entry is asked about. */
function technologyFields(
  entry: Entry,
  relations: { incoming: RelationView[] },
  now: number
): Record<string, AttributeValue> {
  const incoming = relations.incoming.filter((relation) => relation.other?.kind === 'project');
  const provider = incoming.find((relation) => relation.kind === 'provides');
  return {
    used_by: incoming.filter((relation) => relation.kind === 'uses').length,
    ring_stale: isRingStale(entry.reviewAfter, now),
    ...(provider?.other ? { provided_by: provider.other.slug } : {})
  };
}

/**
 * Everything the query grammar can ask for that is not stored anywhere: the filesystem source's
 * path, the attention classification, the collector warning count, the technologies an entry is
 * linked to, and the two snapshot deltas the old sort keys used. Computing them here is what makes
 * `--filter missing`, `--view`, `--stack`, and `tech:` ordinary field clauses.
 */
function derive(
  repository: CatalogRepository,
  registry: FieldRegistry,
  entry: Entry,
  sources: EntrySource[],
  declarations: readonly DeclaredStack[],
  releases: ReadonlyMap<Toolchain, ToolchainRelease[]>,
  relations: { outgoing: RelationView[]; incoming: RelationView[] },
  entries: ReadonlyMap<string, Entry>,
  now: number
): Derived {
  const filesystem = sources.find((source) => source.provider === FILESYSTEM_PROVIDER);
  const path = filesystem?.locator ?? null;
  const isMissing = filesystem ? filesystem.missingSince !== null : false;
  const tech = [
    ...new Set(
      relations.outgoing
        .filter((relation) => TECH_RELATION_KINDS.includes(relation.kind))
        .map((relation) => relation.other?.slug)
        .filter((slug): slug is string => Boolean(slug))
    )
  ];
  // Every required field is stored — a column or an attribute — so completeness is decided before
  // anything is projected, and the browser can recompute it from the same two sources after an edit.
  const completeness = entryCompleteness(registry, entry.kind, {
    ...columnFields(entry),
    ...entry.attributes
  });
  const fields: Record<string, AttributeValue> = { complete: completeness.complete };
  if (filesystem) {
    fields.path = filesystem.locator;
    fields.is_missing = isMissing;
  }
  if (tech.length) fields.tech = tech;

  if (entry.kind === TECHNOLOGY_KIND)
    Object.assign(fields, technologyFields(entry, relations, now));

  if (entry.kind !== 'project')
    return {
      path,
      isMissing,
      views: [],
      attention: null,
      metrics: null,
      stacks: [],
      errors: [],
      technologies: [],
      fields
    };

  const technologies = usedTechnologies(relations, entries);

  const metrics = repository.getMetrics(entry.id);
  const snapshots = repository.listSnapshots(entry.id);
  const errors = repository.listCollectionErrors(entry.id, true);
  const stacks = declarations.map((declared) =>
    resolveStack(declared, releases.get(declared.toolchain) ?? [], now)
  );
  const githubStarsGained30d = metricDelta30d(
    snapshots,
    'github_stars',
    metrics?.githubStars ?? null,
    now
  );
  const githubTrafficViewsDelta30d = metricDelta30d(
    snapshots,
    'github_traffic_views',
    metrics?.githubTrafficViews ?? null,
    now
  );
  const attention = classifyAttentionViews(
    {
      id: entry.id,
      isMissing,
      intent: (entry.attributes.intent ?? null) as ProjectIntent | null,
      metrics,
      stacks,
      errors,
      technologies,
      completeness,
      githubStarsGained30d,
      githubTrafficViewsDelta30d,
      githubTrafficClonesDelta30d: metricDelta30d(
        snapshots,
        'github_traffic_clones',
        metrics?.githubTrafficClones ?? null,
        now
      )
    },
    now
  );
  const views = attentionViewKeys.filter((key) => attention[key].member);

  fields.warnings = errors.length;
  const lag = stackLag(stacks);
  if (lag !== null) fields['stack.lag'] = lag;
  if (views.length) fields.views = [...views];
  if (githubStarsGained30d !== null) fields['github.starsGained30d'] = githubStarsGained30d;
  if (githubTrafficViewsDelta30d !== null)
    fields['github.trafficViewsDelta30d'] = githubTrafficViewsDelta30d;

  return {
    path,
    isMissing,
    views: [...views],
    attention,
    metrics,
    stacks,
    errors,
    technologies,
    fields: { ...fields, ...projectProviderFields(metrics, declarations) }
  };
}

function entryView(
  entry: Entry,
  sources: EntrySource[],
  derived: Derived,
  relations: { outgoing: RelationView[]; incoming: RelationView[] }
): EntryView {
  return {
    id: entry.id,
    kind: entry.kind,
    slug: entry.slug,
    name: entry.name,
    note: entry.note,
    tags: entry.tags,
    isFavorite: entry.isFavorite,
    isHidden: entry.isHidden,
    reviewAfter: entry.reviewAfter,
    path: derived.path,
    isMissing: derived.isMissing,
    attributes: entry.attributes,
    fields: { ...columnFields(entry), ...entry.attributes, ...derived.fields },
    views: derived.views,
    attention: derived.attention,
    metrics: derived.metrics,
    stacks: derived.stacks,
    errors: derived.errors,
    technologies: derived.technologies,
    sources,
    relations,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

function relationViews(
  entryId: string,
  relations: readonly Relation[],
  entries: ReadonlyMap<string, Entry>
): { outgoing: RelationView[]; incoming: RelationView[] } {
  const describe = (id: string): RelationView['other'] => {
    const entry = entries.get(id);
    return entry ? { id: entry.id, kind: entry.kind, slug: entry.slug, name: entry.name } : null;
  };
  return {
    outgoing: relations
      .filter((relation) => relation.fromId === entryId)
      .map((relation) => ({ ...relation, other: describe(relation.toId) })),
    incoming: relations
      .filter((relation) => relation.toId === entryId)
      .map((relation) => ({ ...relation, other: describe(relation.fromId) }))
  };
}

export function readEntryViews(
  repository: CatalogRepository,
  options: { kind?: string; includeHidden?: boolean; now?: Date } = {}
): EntryView[] {
  const now = (options.now ?? new Date()).getTime();
  const entries = repository.listEntries({
    kind: options.kind,
    includeHidden: options.includeHidden ?? true
  });
  const sources = repository.listAllSources();
  const stacks = repository.listAllProjectStacks();
  const relations = repository.listRelations();
  const releases = repository.listToolchainReleases();
  const registry = repository.registry();
  const byId = new Map(
    repository.listEntries({ includeHidden: true }).map((entry) => [entry.id, entry])
  );
  return entries.map((entry) => {
    const entrySources = sources.get(entry.id) ?? [];
    const edges = relationViews(entry.id, relations, byId);
    return entryView(
      entry,
      entrySources,
      derive(
        repository,
        registry,
        entry,
        entrySources,
        stacks.get(entry.id) ?? [],
        releases,
        edges,
        byId,
        now
      ),
      edges
    );
  });
}

export function readEntryView(
  repository: CatalogRepository,
  entry: Entry,
  now = new Date()
): EntryView {
  const byId = new Map(
    repository.listEntries({ includeHidden: true }).map((other) => [other.id, other])
  );
  const sources = repository.listSources(entry.id);
  const edges = relationViews(entry.id, repository.listRelations({ entryId: entry.id }), byId);
  return entryView(
    entry,
    sources,
    derive(
      repository,
      repository.registry(),
      entry,
      sources,
      repository.listProjectStacks(entry.id),
      repository.listToolchainReleases(),
      edges,
      byId,
      now.getTime()
    ),
    edges
  );
}
