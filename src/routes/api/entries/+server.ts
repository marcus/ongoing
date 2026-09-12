import { json } from '@sveltejs/kit';
import { entryKinds, type AttributeValue } from '$lib/domain/entry';
import { describeField } from '$lib/domain/fields';
import {
  filterRows,
  formatQuery,
  formatSort,
  legacyParamsToQuery,
  parseColumns,
  parseQuery,
  parseSortInput,
  QueryError,
  sortRows,
  validateColumns,
  validateQuery,
  validateSort
} from '$lib/domain/query';
import { failure, readObject } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

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

/**
 * The inventory, as entries, read through one query grammar (ADR 0006). `?q=` filters, `?sort=`
 * orders, `?columns=` says what a caller intends to render, and `?saved=` prepends a saved view's
 * query. The pre-Phase-2 parameters — `view`, `filter`, `stack`, `search`, `kind`, `dir` — are
 * translated into clauses by {@link legacyParamsToQuery} and keep working for one release; the
 * translation table is documented in docs/cli.md and asserted by the tests.
 */
export const GET: RequestHandler = async ({ url }) => {
  let catalogRepository;
  let readEntryViews;
  try {
    ({ catalogRepository } = await import('$lib/server/scanning/runtime'));
    ({ readEntryViews } = await import('$lib/server/catalog/entries'));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'The catalog could not be opened' },
      { status: 503 }
    );
  }

  const parameter = (name: string): string | null => url.searchParams.get(name);
  const savedName = parameter('saved');
  const saved = savedName ? catalogRepository.getSavedView(savedName) : null;
  if (savedName && !saved)
    return json({ error: `Unknown saved view: ${savedName}` }, { status: 404 });

  const registry = catalogRepository.registry();
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

  try {
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

    const all = readEntryViews(catalogRepository, { includeHidden: true });
    const matched = sortRows(filterRows(all, query, registry), sort, registry);
    const limit = Number(parameter('limit') ?? NaN);
    const entries = Number.isFinite(limit) ? matched.slice(0, Math.max(0, limit)) : matched;

    return json({
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
      baselines: catalogRepository.listBaselineStatus(),
      scan: catalogRepository.getLatestScanRun(),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof QueryError) return json({ error: error.message }, { status: 400 });
    return json(
      { error: error instanceof Error ? error.message : 'The catalog could not be read' },
      { status: 503 }
    );
  }
};

/**
 * Creates an entry that no provider discovered — a technology, or anything else a person catalogs
 * by hand. Discovery still owns projects: a project entry gets its filesystem source from a scan,
 * so creating one here would be an entry with nowhere to point.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const { readEntryView } = await import('$lib/server/catalog/entries');
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!entryKinds.includes(kind as (typeof entryKinds)[number]))
    return json({ error: `kind must be one of ${entryKinds.join(', ')}` }, { status: 400 });
  if (kind === 'project')
    return json(
      { error: 'Projects are discovered, not created — run a scan over their directory' },
      { status: 400 }
    );
  if (typeof body.name !== 'string' || !body.name.trim())
    return json({ error: 'name is required' }, { status: 400 });
  const reserved = new Set(['kind', 'name', 'slug']);
  try {
    const entry = await catalogRepository.createEntry({
      kind,
      name: body.name,
      slug: typeof body.slug === 'string' ? body.slug : undefined,
      attributes: Object.fromEntries(
        Object.entries(body).filter(([key]) => !reserved.has(key))
      ) as Record<string, AttributeValue>
    });
    return json(readEntryView(catalogRepository, entry), { status: 201 });
  } catch (error) {
    return failure(error, 'Unable to create entry');
  }
};
