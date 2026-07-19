export const PROJECT_NOTE_MAX_LENGTH = 500;
export const MANUAL_RANK_STEP = 1_000;

export const projectIntents = ['invest', 'maintain', 'experiment', 'hibernate', 'archive'] as const;

export type ProjectIntent = (typeof projectIntents)[number];

export interface Project {
  id: string;
  canonicalPath: string;
  relativePath: string;
  name: string;
  scanRoot: string;
  isFavorite: boolean;
  isHidden: boolean;
  manualRank: number;
  note: string;
  intent: ProjectIntent | null;
  excitement: number | null;
  strategicImportance: number | null;
  nextAction: string | null;
  reviewAfter: string | null;
  isMissing: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface DiscoveredProject {
  canonicalPath: string;
  relativePath: string;
  name: string;
  scanRoot: string;
}

export interface ProjectDecisionUpdate {
  intent?: ProjectIntent | null;
  excitement?: number | null;
  strategicImportance?: number | null;
  nextAction?: string | null;
  reviewAfter?: string | null;
}

export function validateProjectNote(note: string): void {
  if (note.length > PROJECT_NOTE_MAX_LENGTH) {
    throw new RangeError(`Project notes may not exceed ${PROJECT_NOTE_MAX_LENGTH} characters`);
  }
}

export function validateDecisionUpdate(update: ProjectDecisionUpdate): void {
  if (
    update.intent !== undefined &&
    update.intent !== null &&
    !projectIntents.includes(update.intent)
  ) {
    throw new TypeError(`Unknown project intent: ${update.intent}`);
  }

  for (const [field, value] of [
    ['excitement', update.excitement],
    ['strategicImportance', update.strategicImportance]
  ] as const) {
    if (
      value !== undefined &&
      value !== null &&
      (!Number.isInteger(value) || value < 1 || value > 5)
    ) {
      throw new RangeError(`${field} must be an integer from 1 through 5`);
    }
  }
}

export function assignManualRanks(
  orderedIds: readonly string[],
  expectedIds: readonly string[]
): ReadonlyMap<string, number> {
  const expected = new Set(expectedIds);
  const ordered = new Set(orderedIds);

  if (ordered.size !== orderedIds.length) {
    throw new Error('Manual order contains duplicate project IDs');
  }

  const unknown = orderedIds.filter((id) => !expected.has(id));
  if (unknown.length > 0) {
    throw new Error(`Manual order contains unknown project IDs: ${unknown.join(', ')}`);
  }

  const missing = expectedIds.filter((id) => !ordered.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Manual order must include every visible project ID; missing: ${missing.join(', ')}`
    );
  }

  return new Map(orderedIds.map((id, index) => [id, (index + 1) * MANUAL_RANK_STEP]));
}
