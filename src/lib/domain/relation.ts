import type { AttributeValue } from './entry';

/**
 * Edges between entries are rows with their own attributes, registered like fields so that the
 * kinds they may connect are declared rather than assumed (ADR 0005). `declared` edges are written
 * by a person through the CLI or the API; `detected` edges belong to the provider that wrote them,
 * are rewritten on every scan, and are never edited by hand.
 */
export const relationEvidence = ['declared', 'detected'] as const;

export type RelationEvidence = (typeof relationEvidence)[number];

export interface RelationKindDefinition {
  kind: string;
  from: readonly string[];
  to: readonly string[];
  label: string;
  description: string;
}

export const relationKinds: readonly RelationKindDefinition[] = [
  {
    kind: 'uses',
    from: ['project'],
    to: ['technology'],
    label: 'uses',
    description: 'The project depends on the technology; the edge carries the declared version'
  },
  {
    kind: 'provides',
    from: ['project'],
    to: ['technology'],
    label: 'provides',
    description: 'The project is what supplies the technology (td, comms, roc)'
  },
  {
    // Registered but unwritten until a real question arrives: "provided by project X" answers the
    // version of it that comes up today, and an edge nobody maintains is worse than no edge.
    kind: 'depends_on',
    from: ['project'],
    to: ['project'],
    label: 'depends on',
    description: 'One project needs another to work'
  },
  {
    kind: 'part_of',
    from: ['project'],
    to: ['project'],
    label: 'part of',
    description: 'One project is a component of another'
  }
];

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  evidence: RelationEvidence;
  /** The provider that wrote a detected edge, and null for a declared one. */
  provider: string | null;
  attributes: Record<string, AttributeValue>;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationInput {
  fromId: string;
  toId: string;
  kind: string;
  evidence?: RelationEvidence;
  provider?: string | null;
  attributes?: Record<string, AttributeValue>;
  note?: string | null;
}

export class RelationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelationValidationError';
  }
}

export function getRelationKind(kind: string): RelationKindDefinition | undefined {
  return relationKinds.find((definition) => definition.kind === kind);
}

/** Checks a proposed edge against the registered relation kinds. Pure; no store involved. */
export function validateRelation(input: {
  kind: string;
  fromKind: string;
  toKind: string;
  evidence?: string;
  note?: string | null;
}): RelationKindDefinition {
  const definition = getRelationKind(input.kind);
  if (!definition)
    throw new RelationValidationError(
      `Unknown relation kind: ${input.kind} — try ${relationKinds.map(({ kind }) => kind).join(', ')}`
    );
  if (!definition.from.includes(input.fromKind))
    throw new RelationValidationError(
      `${definition.kind} starts at ${definition.from.join(' or ')} entries, not ${input.fromKind}`
    );
  if (!definition.to.includes(input.toKind))
    throw new RelationValidationError(
      `${definition.kind} points at ${definition.to.join(' or ')} entries, not ${input.toKind}`
    );
  if (
    input.evidence !== undefined &&
    !relationEvidence.includes(input.evidence as RelationEvidence)
  )
    throw new RelationValidationError(`evidence must be declared or detected`);
  if (input.note !== undefined && input.note !== null && input.note.length > 500)
    throw new RelationValidationError('Relation notes may not exceed 500 characters');
  return definition;
}
