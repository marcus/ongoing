import { attentionViewKeys, classifyAttentionViews } from '$lib/domain/attention';
import type { AttributeValue, Entry, EntrySource } from '$lib/domain/entry';
import { metricDelta30d, type CollectionError } from '$lib/domain/metrics';
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
export interface RelationView extends Relation {
  /** The entry at the other end, so a caller can render an edge without a second lookup. */
  other: { id: string; kind: string; slug: string; name: string } | null;
}

export interface EntryView {
  id: string;
  kind: string;
  slug: string;
  name: string;
  note: string;
  tags: string[];
  isFavorite: boolean;
  isHidden: boolean;
  reviewAfter: string | null;
  /** Where the filesystem provider found it, when it found it anywhere. */
  path: string | null;
  isMissing: boolean;
  attributes: Record<string, AttributeValue>;
  fields: Record<string, AttributeValue>;
  /** Attention views this entry is currently in; the reasons live on the single-entry read. */
  views: string[];
  stacks: ResolvedStack[];
  errors: CollectionError[];
  /** Technologies a project uses, resolved through its `uses` edges. Empty for other kinds. */
  technologies: UsedTechnology[];
  sources: EntrySource[];
  relations: { outgoing: RelationView[]; incoming: RelationView[] };
  createdAt: string;
  updatedAt: string;
}

const FILESYSTEM_PROVIDER = 'filesystem';

/** Relation kinds that put a technology into an entry's `tech` field. */
const TECH_RELATION_KINDS = ['uses', 'provides'];

function columnFields(entry: Entry): Record<string, AttributeValue> {
  return {
    kind: entry.kind,
    name: entry.name,
    slug: entry.slug,
    note: entry.note,
    tags: entry.tags,
    is_favorite: entry.isFavorite,
    is_hidden: entry.isHidden,
    review_after: entry.reviewAfter
  };
}

interface Derived {
  path: string | null;
  isMissing: boolean;
  views: string[];
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
  const fields: Record<string, AttributeValue> = {};
  if (filesystem) {
    fields.path = filesystem.locator;
    fields.is_missing = isMissing;
  }
  if (tech.length) fields.tech = tech;

  if (entry.kind === TECHNOLOGY_KIND)
    Object.assign(fields, technologyFields(entry, relations, now));

  if (entry.kind !== 'project')
    return { path, isMissing, views: [], stacks: [], errors: [], technologies: [], fields };

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
