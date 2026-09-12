import { describeField } from '$lib/domain/fields';
import {
  filterRows,
  formatQuery,
  formatSort,
  legacyParamsToQuery,
  parseColumns,
  parseQuery,
  parseSortInput,
  sortRows,
  validateColumns,
  validateQuery,
  validateSort
} from '$lib/domain/query';
import { readEntryViews } from '$lib/server/catalog/entries';
import type { CatalogRepository } from '$lib/server/catalog/repository';

/**
 * `GET /api/entries`, as a library function.
 *
 * The route is a thin shell over this, and so is the CLI's in-process transport (Decision 1), so
 * "read the catalog through the query grammar" has exactly one implementation no matter which
 * surface asked. Parameters arrive as a lookup rather than a `URL` so a caller with no request
 * object can use it.
 */
export type ParameterLookup = (name: string) => string | null;

export interface EntriesPageError {
  status: number;
  error: string;
}

export function readEntriesPage(
  repository: CatalogRepository,
  parameter: ParameterLookup
): Record<string, unknown> | EntriesPageError {
  const savedName = parameter('saved');
  const saved = savedName ? repository.getSavedView(savedName) : null;
  if (savedName && !saved) return { status: 404, error: `Unknown saved view: ${savedName}` };

  const registry = repository.registry();
  const legacy = legacyParamsToQuery({
    view: parameter('view'),
    filter: parameter('filter'),
    stack: parameter('stack'),
    tech: parameter('tech'),
    search: parameter('search') ?? parameter('text'),
    hidden: parameter('hidden') === 'false' ? false : undefined
  });
  const base = [saved?.query ?? '', parameter('q') ?? '', legacy].filter(Boolean).join(' ');
  // `?kind=` and a saved view's kind are shorthand for a `kind:` clause, and are dropped when the
  // query already pins one, so the echoed query stays the string a caller could have typed.
  const pinned = singleKind(parseQuery(base));
  const requestedKind = parameter('kind') ?? saved?.kind ?? undefined;

  const query = parseQuery(
    pinned === undefined && requestedKind ? `kind:${requestedKind} ${base}` : base
  );
  const kind = pinned ?? requestedKind;
  validateQuery(query, registry, kind);
  const sort = parseSortInput(
    parameter('sort'),
    parameter('dir') === 'asc' ? 'asc' : parameter('dir') === 'desc' ? 'desc' : undefined
  );
  validateSort(sort, registry, kind);
  const columns = parseColumns(parameter('columns') ?? saved?.columns.join(',') ?? '');
  validateColumns(columns, registry, kind);

  const all = readEntryViews(repository, { includeHidden: true });
  const matched = sortRows(filterRows(all, query, registry), sort, registry);
  const limit = Number(parameter('limit') ?? NaN);
  const entries = Number.isFinite(limit) ? matched.slice(0, Math.max(0, limit)) : matched;

  return {
    query: formatQuery(query),
    sort: formatSort(sort),
    columns,
    saved: saved ?? null,
    entries,
    total: matched.length,
    returned: entries.length,
    catalogTotal: all.filter((entry) => !kind || entry.kind === kind).length,
    hiddenCount: all.filter((entry) => entry.isHidden && (!kind || entry.kind === kind)).length,
    fields: registry.fields
      .filter((field) => !kind || field.kinds.includes('*') || field.kinds.includes(kind))
      .map(describeField),
    baselines: repository.listBaselineStatus(),
    scan: repository.getLatestScanRun(),
    generatedAt: new Date().toISOString()
  };
}

export function isEntriesPageError(
  value: Record<string, unknown> | EntriesPageError
): value is EntriesPageError {
  return typeof (value as EntriesPageError).status === 'number';
}

/** The single kind a query pins itself to, when it pins itself to exactly one. */
function singleKind(query: ReturnType<typeof parseQuery>): string | undefined {
  const clauses = query.clauses.filter(
    (clause) => clause.type === 'field' && clause.field === 'kind' && !clause.negated
  );
  const values = new Set(
    clauses.flatMap((clause) => (clause.type === 'field' ? clause.values : []))
  );
  return values.size === 1 ? [...values][0] : undefined;
}
