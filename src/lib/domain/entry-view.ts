import type { AttentionClassifications } from './attention';
import type { AttributeValue, EntrySource } from './entry';
import type { CollectionError, ProjectMetrics } from './metrics';
import type { Relation } from './relation';
import type { ResolvedStack } from './stack';
import type { UsedTechnology } from './technology';

/**
 * The shape the read model produces and every surface consumes. It lives in `domain` rather than
 * beside the read model because the browser re-runs the domain rules over it after an optimistic
 * edit (ADR 0008), and a type that only exists under `$lib/server` cannot be imported there.
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
  /** Attention views this entry is currently in. */
  views: string[];
  /**
   * The full classification, reasons included, for the entries surface that shows why. Null for
   * kinds the attention rules say nothing about.
   */
  attention: AttentionClassifications | null;
  /** The provider's metric row, so a fact sheet can render a panel the projection does not flatten. */
  metrics: ProjectMetrics | null;
  stacks: ResolvedStack[];
  errors: CollectionError[];
  /** Technologies a project uses, resolved through its `uses` edges. Empty for other kinds. */
  technologies: UsedTechnology[];
  sources: EntrySource[];
  relations: { outgoing: RelationView[]; incoming: RelationView[] };
  createdAt: string;
  updatedAt: string;
}
