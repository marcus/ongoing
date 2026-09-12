import type { FieldDefinition, FieldRegistry } from '$lib/domain/fields';
import {
  formatSort,
  listDefaultClauses,
  parseColumns,
  parseQuery,
  parseSort,
  type ParsedQuery,
  type SortKey
} from '$lib/domain/query';
import type { SavedView } from '$lib/domain/view';

/**
 * The URL *is* the query. `?q=`, `?sort=`, `?columns=`, and `?saved=` carry exactly the strings
 * the CLI flags and the API parameters carry, built with `formatQuery` and `formatSort`, so a
 * pasted URL is an `ongoing list` command and back again (ADR 0006).
 *
 * `?entry=` is the only piece of state that is not part of the query: which row the detail panel
 * is showing. It is in the URL for the same reason — a link to a row should be a link to a row.
 */
export interface InventoryState {
  /** The effective query: a saved view's query and `?q=` joined, which is what the server sees. */
  query: string;
  /** Just the `?q=` half, which is what a URL rebuild has to carry. */
  explicitQuery: string;
  parsed: ParsedQuery;
  sort: SortKey[];
  columns: string[];
  /** True when `columns` came from the URL rather than from a view or a default. */
  columnsPinned: boolean;
  saved: string | null;
  /** `kind/slug` of the entry the panel is open on. */
  entry: string | null;
  /** The single kind this query pins itself to, when it pins one. */
  kind: string | null;
}

export const DEFAULT_COLUMNS: Readonly<Record<string, string[]>> = {
  project: [
    'name',
    'intent',
    'git.latestCommit',
    'git.commits30d',
    'td.total',
    'github.stars',
    'loc.code'
  ],
  technology: ['name', 'ring', 'technology_kind', 'used_by', 'tool_surface']
};

const FALLBACK_COLUMNS = ['name', 'kind', 'tags'];

/**
 * What `/` means with nothing in the URL — the same clauses `ongoing list` prepends when a query
 * has not spoken about them (`listDefaultClauses`). They are shown in the filter box and editable
 * like any other clause rather than kept as hidden state, and a query that names `kind` or
 * `is_hidden` simply wins. Sharing the rule with the CLI is what makes a URL and an `ongoing list`
 * invocation the same command rather than two things that mostly agree.
 */
export const DEFAULT_QUERY = listDefaultClauses(parseQuery('')).join(' ');

/** The kind a query pins itself to, when exactly one `kind:` value appears un-negated. */
export function pinnedKind(parsed: ParsedQuery): string | null {
  const values = new Set(
    parsed.clauses.flatMap((clause) =>
      clause.type === 'field' && clause.field === 'kind' && !clause.negated ? clause.values : []
    )
  );
  return values.size === 1 ? [...values][0] : null;
}

export function defaultColumnsFor(kind: string | null): string[] {
  return [...(kind && DEFAULT_COLUMNS[kind] ? DEFAULT_COLUMNS[kind] : FALLBACK_COLUMNS)];
}

/**
 * Read the whole inventory state out of a URL. A saved view supplies the query, the columns, and
 * the kind it lists; anything written explicitly in the URL is appended to it, so narrowing a
 * saved view stays inside the view rather than replacing it.
 */
export function readInventoryState(
  params: URLSearchParams,
  views: readonly SavedView[]
): InventoryState {
  const savedName = params.get('saved');
  const saved = savedName ? (views.find((view) => view.name === savedName) ?? null) : null;
  const explicitQuery = (params.get('q') ?? '').trim();
  const written = [saved?.query ?? '', explicitQuery].filter(Boolean).join(' ').trim();
  const query = [...listDefaultClauses(parseQuery(written)), written].filter(Boolean).join(' ');
  const parsed = parseQuery(query);
  const kind = pinnedKind(parsed) ?? saved?.kind ?? null;
  const columnsParam = params.get('columns');
  const columns = columnsParam
    ? parseColumns(columnsParam)
    : saved?.columns.length
      ? [...saved.columns]
      : defaultColumnsFor(kind);
  return {
    query,
    explicitQuery,
    parsed,
    sort: parseSort(params.get('sort') ?? ''),
    columns,
    columnsPinned: Boolean(columnsParam),
    saved: saved ? saved.name : null,
    entry: params.get('entry'),
    kind
  };
}

export interface InventoryPatch {
  /** Replaces the whole effective query and leaves any saved view behind. */
  query?: string;
  sort?: SortKey[];
  columns?: string[];
  saved?: string | null;
  entry?: string | null;
}

/**
 * The href for a change to the inventory state. Defaults stay out of the URL: a link carries what
 * a caller chose, not what the app would have done anyway.
 *
 * Editing the query takes ownership of it — the saved view's name is dropped, because the query
 * shown in the filter box already contains the view's clauses and keeping the name would claim the
 * view says something it does not.
 */
export function inventoryHref(state: InventoryState, patch: InventoryPatch = {}): string {
  const takingOver = patch.query !== undefined;
  const saved = patch.saved !== undefined ? patch.saved : takingOver ? null : state.saved;
  const explicit =
    patch.saved !== undefined ? '' : takingOver ? patch.query!.trim() : state.explicitQuery;
  const sort = patch.sort ?? state.sort;
  const columns =
    patch.columns ??
    (patch.saved !== undefined ? null : state.columnsPinned ? state.columns : null);
  const entry = patch.entry !== undefined ? patch.entry : state.entry;

  const params = new URLSearchParams();
  if (saved) params.set('saved', saved);
  if (explicit) params.set('q', explicit);
  if (sort.length) params.set('sort', formatSort(sort));
  if (columns?.length) params.set('columns', columns.join(','));
  if (entry) params.set('entry', entry);
  const search = params.toString();
  return search ? `/?${search}` : '/';
}

/**
 * Cycle one column's sort: ascending, descending, then gone. Multi-key sorts are what the grammar
 * supports, so a newly chosen key goes to the front and the rest stay behind it.
 */
export function toggleSort(sort: readonly SortKey[], field: string): SortKey[] {
  const existing = sort.find((key) => key.field === field);
  const rest = sort.filter((key) => key.field !== field);
  if (!existing) return [{ field, direction: 'asc' }, ...rest];
  if (existing.direction === 'asc') return [{ field, direction: 'desc' }, ...rest];
  return rest;
}

/** The columns to render, resolved against the registry so an unknown key is dropped, not fatal. */
export function resolveColumns(
  keys: readonly string[],
  registry: FieldRegistry,
  kind: string | null
): FieldDefinition[] {
  const resolved = keys.flatMap((key) => registry.get(key) ?? []);
  return resolved.length
    ? resolved
    : defaultColumnsFor(kind).flatMap((key) => registry.get(key) ?? []);
}
