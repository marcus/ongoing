import type { AttributeValue, Entry, EntrySource } from '$lib/domain/entry';
import { projectProviderFields } from '$lib/domain/provider-fields';
import type { Relation } from '$lib/domain/relation';
import type { CatalogRepository } from './repository';

/**
 * The read model. Stored attributes and provider metrics are merged into one flat `fields` map, so
 * a caller — the API, the CLI, and from Phase 2 the query evaluator — cannot tell a projected
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
  attributes: Record<string, AttributeValue>;
  fields: Record<string, AttributeValue>;
  sources: EntrySource[];
  relations: { outgoing: RelationView[]; incoming: RelationView[] };
  createdAt: string;
  updatedAt: string;
}

function columnFields(entry: Entry): Record<string, AttributeValue> {
  return {
    name: entry.name,
    slug: entry.slug,
    note: entry.note,
    tags: entry.tags,
    is_favorite: entry.isFavorite,
    is_hidden: entry.isHidden,
    review_after: entry.reviewAfter
  };
}

function entryView(
  entry: Entry,
  sources: EntrySource[],
  provider: Record<string, AttributeValue>,
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
    attributes: entry.attributes,
    fields: { ...columnFields(entry), ...entry.attributes, ...provider },
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
  options: { kind?: string; includeHidden?: boolean } = {}
): EntryView[] {
  const entries = repository.listEntries({
    kind: options.kind,
    includeHidden: options.includeHidden ?? true
  });
  const sources = repository.listAllSources();
  const stacks = repository.listAllProjectStacks();
  const relations = repository.listRelations();
  const byId = new Map(
    repository.listEntries({ includeHidden: true }).map((entry) => [entry.id, entry])
  );
  return entries.map((entry) =>
    entryView(
      entry,
      sources.get(entry.id) ?? [],
      projectProviderFields(repository.getMetrics(entry.id), stacks.get(entry.id) ?? []),
      relationViews(entry.id, relations, byId)
    )
  );
}

export function readEntryView(repository: CatalogRepository, entry: Entry): EntryView {
  const byId = new Map(
    repository.listEntries({ includeHidden: true }).map((other) => [other.id, other])
  );
  return entryView(
    entry,
    repository.listSources(entry.id),
    projectProviderFields(repository.getMetrics(entry.id), repository.listProjectStacks(entry.id)),
    relationViews(entry.id, repository.listRelations({ entryId: entry.id }), byId)
  );
}
