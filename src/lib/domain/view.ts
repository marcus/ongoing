import { attentionViewKeys } from './attention';
import { toolchainKeys } from './stack';

/**
 * A saved view is a stored query plus the columns to show. The query is the same string the CLI
 * flag, the URL, and the API parameter carry, so a saved view is a bookmark rather than a second
 * query language (ADR 0006).
 */
export interface SavedView {
  id: string;
  name: string;
  /** The entry kind the view lists, or null for every kind. */
  kind: string | null;
  query: string;
  columns: string[];
  position: number;
  /** Declared in code and always present; a stored view of the same name shadows it. */
  builtin: boolean;
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

const EPOCH = '1970-01-01T00:00:00.000Z';

function builtin(
  name: string,
  query: string,
  columns: string[],
  position: number,
  kind: string | null = 'project'
): SavedView {
  return {
    id: `builtin:${name}`,
    name,
    kind,
    query,
    columns,
    position,
    builtin: true,
    createdAt: EPOCH,
    updatedAt: EPOCH
  };
}

/**
 * The views Ongoing ships with. They are declared in code rather than seeded as rows — the same
 * reasoning as `builtinFields` — so a fresh database and an upgraded one agree without a data
 * migration, and so `ongoing views` and `ongoing stacks` keep working as the query model takes
 * over from the hard-coded attention and toolchain filters. A stored view of the same name
 * shadows the built-in one, which is how a user customises rather than deletes.
 */
export const builtinSavedViews: readonly SavedView[] = [
  builtin('all', 'kind:project', ['name', 'intent', 'git.latestCommit', 'loc.code'], 0),
  builtin('favorites', 'kind:project is_favorite:true', ['name', 'intent', 'git.latestCommit'], 1),
  builtin('hidden', 'kind:project is_hidden:true', ['name', 'intent'], 2),
  builtin('missing', 'kind:project is_missing:true', ['name', 'path'], 3),
  builtin('warnings', 'kind:project warnings>0', ['name', 'warnings'], 4),
  builtin(
    'incomplete',
    'kind:project complete<100',
    ['name', 'complete', 'intent', 'next_action'],
    5
  ),
  ...attentionViewKeys.map((view, index) =>
    builtin(
      view,
      `kind:project view:${view}`,
      ['name', 'git.latestCommit', 'git.commits30d', 'td.total', 'github.stars'],
      10 + index
    )
  ),
  ...toolchainKeys.map((toolchain, index) =>
    builtin(
      `stack-${toolchain}`,
      `kind:project stack.${toolchain}:*`,
      ['name', `stack.${toolchain}`, 'git.latestCommit'],
      30 + index
    )
  ),
  builtin('technologies', 'kind:technology', ['name', 'ring', 'technology_kind'], 60, 'technology')
];

/** Built-in views first, then stored ones; a stored view shadows a built-in of the same name. */
export function mergeSavedViews(stored: readonly SavedView[]): SavedView[] {
  const names = new Set(stored.map((view) => view.name));
  return [...builtinSavedViews.filter((view) => !names.has(view.name)), ...stored].sort(
    (left, right) => left.position - right.position || left.name.localeCompare(right.name, 'en')
  );
}
