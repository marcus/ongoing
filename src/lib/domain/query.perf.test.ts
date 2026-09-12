import { describe, expect, it } from 'vitest';
import type { AttributeValue } from './entry';
import { createFieldRegistry } from './fields';
import { filterRows, parseQuery, parseSort, sortRows, type QueryRow } from './query';

/**
 * The interaction budget, asserted where the work actually happens.
 *
 * A list operation in the browser — typing a filter, clicking a sort key, choosing a column — is
 * `parseQuery` plus `filterRows` plus `sortRows` over rows that are already in memory. No round
 * trip, no re-render of anything the operation did not touch. ADR 0008 asks for those operations
 * to stay under 100 ms at 500 entries; this is that measurement. The browser side is timed once in
 * `tests/e2e/inventory.test.ts` to catch a regression that turns one of them into a fetch.
 */
const ENTRY_COUNT = 500;
const BUDGET_MS = 100;

const INTENTS = ['invest', 'maintain', 'experiment', 'hibernate', 'archive'];
const LANGUAGES = ['TypeScript', 'Go', 'Rust', 'Python', 'Ruby'];

function catalog(count: number): QueryRow[] {
  const day = 86_400_000;
  const base = Date.parse('2026-01-01T00:00:00Z');
  return Array.from({ length: count }, (_, index) => {
    const fields: Record<string, AttributeValue> = {
      kind: 'project',
      name: `project-${String(index).padStart(4, '0')}`,
      slug: `project-${index}`,
      note: `a catalogued project, number ${index}, with a sentence of note text`,
      path: `/code/project-${index}`,
      tags: index % 3 === 0 ? ['oss', 'tool'] : ['internal'],
      is_favorite: index % 7 === 0,
      is_hidden: index % 23 === 0,
      intent: INTENTS[index % INTENTS.length],
      excitement: (index % 5) + 1,
      manual_rank: (index + 1) * 1000,
      'git.latestCommit': new Date(base - (index % 400) * day).toISOString(),
      'git.commits30d': index % 60,
      'git.commitCount': index * 7,
      'loc.code': (index % 97) * 431,
      'loc.language': LANGUAGES[index % LANGUAGES.length],
      'td.total': index % 17,
      'github.stars': (index % 50) * 11,
      warnings: index % 11 === 0 ? 2 : 0,
      tech: index % 2 === 0 ? ['go'] : ['sveltekit', 'bun']
    };
    if (index % 4 === 0) fields.views = ['attention'];
    return { id: `entry-${index}`, fields };
  });
}

function elapsed(work: () => void): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe(`list operations at ${ENTRY_COUNT} entries`, () => {
  const registry = createFieldRegistry();
  const rows = catalog(ENTRY_COUNT);

  it('filters a multi-clause query inside the budget', () => {
    const query = parseQuery(
      'kind:project intent:invest,maintain github.stars>=100 -tag:archived loc.code<30000'
    );
    let matched: QueryRow[] = [];
    const duration = elapsed(() => {
      matched = filterRows(rows, query, registry);
    });
    expect(matched.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(BUDGET_MS);
  });

  it('runs a bare text search inside the budget', () => {
    const query = parseQuery('catalogued');
    const duration = elapsed(() => filterRows(rows, query, registry));
    expect(duration).toBeLessThan(BUDGET_MS);
  });

  it('sorts on several keys inside the budget', () => {
    const keys = parseSort('-git.commits30d,intent,name');
    let sorted: QueryRow[] = [];
    const duration = elapsed(() => {
      sorted = sortRows(rows, keys, registry);
    });
    expect(sorted).toHaveLength(ENTRY_COUNT);
    expect(duration).toBeLessThan(BUDGET_MS);
  });

  it('filters and sorts together — one whole list operation — inside the budget', () => {
    const query = parseQuery('kind:project view:attention');
    const keys = parseSort('-github.stars,name');
    const duration = elapsed(() => sortRows(filterRows(rows, query, registry), keys, registry));
    expect(duration).toBeLessThan(BUDGET_MS);
  });

  it('re-parses the query on every keystroke inside the budget', () => {
    const typed = 'intent:invest github.stars>=100 -tag:archived';
    const duration = elapsed(() => {
      for (let length = 1; length <= typed.length; length += 1)
        filterRows(rows, parseQuery(typed.slice(0, length)), registry);
    });
    // Every prefix of the query, filtered — what a filter box does as someone types it.
    expect(duration).toBeLessThan(BUDGET_MS * typed.length);
  });
});
