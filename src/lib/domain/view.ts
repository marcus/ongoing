/**
 * A saved view is a stored query plus the columns to show. The query is the same string the CLI
 * flag, the URL, and the API parameter carry, so a saved view is a bookmark rather than a second
 * query language (ADR 0006). Phase 2 gives the string its grammar; Phase 1 only stores it.
 */
export interface SavedView {
  id: string;
  name: string;
  /** The entry kind the view lists, or null for every kind. */
  kind: string | null;
  query: string;
  columns: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewInput {
  name: string;
  kind?: string | null;
  query?: string;
  columns?: string[];
  position?: number;
}

export const SAVED_VIEW_NAME_MAX_LENGTH = 60;
export const SAVED_VIEW_QUERY_MAX_LENGTH = 500;

export class SavedViewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SavedViewValidationError';
  }
}

export function validateSavedView(input: Record<string, unknown>): SavedViewInput {
  const fail = (message: string): never => {
    throw new SavedViewValidationError(message);
  };
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > SAVED_VIEW_NAME_MAX_LENGTH)
    fail(`name is required and must not exceed ${SAVED_VIEW_NAME_MAX_LENGTH} characters`);

  const query = input.query === undefined ? '' : input.query;
  if (typeof query !== 'string' || query.length > SAVED_VIEW_QUERY_MAX_LENGTH)
    fail(`query must be a string no longer than ${SAVED_VIEW_QUERY_MAX_LENGTH} characters`);

  const columns = input.columns === undefined ? [] : input.columns;
  if (
    !Array.isArray(columns) ||
    columns.some((column) => typeof column !== 'string' || !column) ||
    columns.length > 30
  )
    fail('columns must be an array of at most 30 field keys');

  if (input.kind !== undefined && input.kind !== null && typeof input.kind !== 'string')
    fail('kind must be an entry kind or null');

  if (
    input.position !== undefined &&
    (typeof input.position !== 'number' || !Number.isInteger(input.position))
  )
    fail('position must be an integer');

  return {
    name,
    kind: (input.kind as string | null | undefined) ?? null,
    query: query as string,
    columns: columns as string[],
    position: input.position as number | undefined
  };
}
