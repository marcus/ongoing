import type { AttributeValue } from './entry';
import type { FieldDefinition } from './fields';
import { exportWebsite, type ProjectWebsite } from './website';

/**
 * Export profiles (Decision 4).
 *
 * "Publish the catalog" is an adapter, not a feature: `opentangle` is the shape OpenTangle's site
 * build reads, and `json` is the generic one a stranger gets. Both are pure functions over rows the
 * caller has already read, so the CLI, the API, and a test all produce byte-identical output for
 * the same catalog.
 */
export const exportProfiles = ['opentangle', 'json'] as const;

export type ExportProfile = (typeof exportProfiles)[number];

export function isExportProfile(value: string): value is ExportProfile {
  return (exportProfiles as readonly string[]).includes(value);
}

export interface ExportSource {
  /** Every entry, already flattened by the read model. */
  entries: readonly {
    id: string;
    kind: string;
    slug: string;
    name: string;
    note: string;
    tags: readonly string[];
    fields: Record<string, AttributeValue>;
  }[];
  relations: readonly {
    kind: string;
    evidence: string;
    provider: string | null;
    from: string;
    to: string;
    attributes: Record<string, AttributeValue>;
  }[];
  fields: readonly FieldDefinition[];
  /** The website records the `opentangle` profile publishes. */
  websites: readonly { website?: ProjectWebsite | null; repositoryVisibility?: string | null }[];
}

export interface ExportOptions {
  /** `opentangle` publishes only selected projects unless drafts are asked for. */
  drafts?: boolean;
  /** Narrow a generic export to one kind. */
  kind?: string;
}

function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The generic profile: entries, their field values, and their edges, sorted so the same catalog
 * always produces the same bytes. It carries no private note unless the entry has one, because the
 * profile's promise is "everything the catalog knows", not "what is safe to publish" — that is what
 * `opentangle` is for.
 */
export function exportCatalog(source: ExportSource, options: ExportOptions = {}) {
  const entries = source.entries
    .filter((entry) => !options.kind || entry.kind === options.kind)
    .slice()
    .sort((left, right) => byString(left.kind, right.kind) || byString(left.slug, right.slug));
  const slugs = new Map(source.entries.map((entry) => [entry.id, `${entry.kind}/${entry.slug}`]));
  return {
    schemaVersion: 1,
    source: 'ongoing',
    profile: 'json' satisfies ExportProfile,
    entries: entries.map((entry) => ({
      kind: entry.kind,
      slug: entry.slug,
      name: entry.name,
      note: entry.note,
      tags: [...entry.tags],
      fields: Object.fromEntries(
        Object.entries(entry.fields).sort(([left], [right]) => byString(left, right))
      )
    })),
    relations: source.relations
      .map((relation) => ({
        kind: relation.kind,
        evidence: relation.evidence,
        provider: relation.provider,
        from: slugs.get(relation.from) ?? relation.from,
        to: slugs.get(relation.to) ?? relation.to,
        attributes: relation.attributes
      }))
      .filter(
        (relation) =>
          !options.kind ||
          entries.some((entry) => `${entry.kind}/${entry.slug}` === relation.from) ||
          entries.some((entry) => `${entry.kind}/${entry.slug}` === relation.to)
      )
      .sort(
        (left, right) =>
          byString(left.from, right.from) ||
          byString(left.kind, right.kind) ||
          byString(left.to, right.to) ||
          byString(left.evidence, right.evidence)
      ),
    fields: source.fields
      .map(({ key, kinds, type, owner, label }) => ({ key, kinds: [...kinds], type, owner, label }))
      .sort((left, right) => byString(left.key, right.key))
  };
}

/** Runs one profile over the catalog. Unknown names fail loudly rather than exporting nothing. */
export function runExportProfile(
  profile: string,
  source: ExportSource,
  options: ExportOptions = {}
): unknown {
  if (!isExportProfile(profile))
    throw new Error(`Unknown export profile: ${profile} (expected ${exportProfiles.join(', ')})`);
  return profile === 'opentangle'
    ? exportWebsite(source.websites, options.drafts)
    : exportCatalog(source, options);
}
