import { describe, expect, it } from 'vitest';
import { createFieldRegistry } from '$lib/domain/fields';
import { builtinSavedViews } from '$lib/domain/view';
import { fuzzyScore, rankPalette, type PaletteItem } from './palette';
import {
  DEFAULT_QUERY,
  inventoryHref,
  readInventoryState,
  resolveColumns,
  toggleSort
} from './query-state';

const views = builtinSavedViews;
const read = (search: string) => readInventoryState(new URLSearchParams(search), views);

describe('readInventoryState', () => {
  it('treats an empty URL as a real, visible query rather than hidden state', () => {
    expect(read('').query).toBe(DEFAULT_QUERY);
    expect(read('').kind).toBe('project');
  });

  it('joins a saved view’s query with the explicit one, so narrowing stays inside the view', () => {
    const state = read('saved=attention&q=intent%3Ainvest');
    // The view already names the kind, so only the hidden-shelf default is prepended.
    expect(state.query).toBe('is_hidden:false kind:project view:attention intent:invest');
    expect(state.saved).toBe('attention');
    expect(state.explicitQuery).toBe('intent:invest');
  });

  it('takes columns from the URL, then the view, then the kind’s defaults', () => {
    expect(read('columns=name,ring').columns).toEqual(['name', 'ring']);
    expect(read('saved=attention').columns).toEqual(builtinSavedViews[5].columns);
    expect(read('q=kind%3Atechnology').columns).toContain('ring');
    expect(read('q=kind%3Aproject').columns).toContain('intent');
  });

  it('reads the sort and the open row', () => {
    const state = read('sort=-github.stars,name&entry=project%2Falpha');
    expect(state.sort).toEqual([
      { field: 'github.stars', direction: 'desc' },
      { field: 'name', direction: 'asc' }
    ]);
    expect(state.entry).toBe('project/alpha');
  });

  it('only pins a kind when exactly one un-negated value appears', () => {
    expect(read('q=kind%3Aproject%2Ctechnology').kind).toBeNull();
    expect(read('q=-kind%3Atechnology').kind).toBeNull();
  });
});

describe('inventoryHref', () => {
  it('leaves defaults out of the URL', () => {
    expect(inventoryHref(read(''))).toBe('/');
  });

  it('round-trips a query, a sort, and chosen columns', () => {
    const state = read('q=intent%3Ainvest&sort=-loc.code&columns=name,loc.code');
    const href = inventoryHref(state);
    expect(href).toContain('q=intent%3Ainvest');
    expect(href).toContain('sort=-loc.code');
    expect(href).toContain('columns=name%2Cloc.code');
    expect(read(href.slice(2)).query).toBe(state.query);
  });

  it('drops the saved view when the query is edited by hand', () => {
    const href = inventoryHref(read('saved=attention'), { query: 'intent:invest' });
    expect(href).not.toContain('saved=');
    expect(href).toContain('q=intent%3Ainvest');
  });

  it('clears the query and the columns when a view is chosen', () => {
    const href = inventoryHref(read('q=intent%3Ainvest&columns=name'), { saved: 'attention' });
    expect(href).toBe('/?saved=attention');
  });

  it('keeps the open row across a sort change', () => {
    const state = read('entry=project%2Falpha');
    expect(inventoryHref(state, { sort: toggleSort(state.sort, 'name') })).toBe(
      '/?sort=name&entry=project%2Falpha'
    );
  });
});

describe('toggleSort', () => {
  it('cycles ascending, descending, then off', () => {
    let sort = toggleSort([], 'name');
    expect(sort).toEqual([{ field: 'name', direction: 'asc' }]);
    sort = toggleSort(sort, 'name');
    expect(sort).toEqual([{ field: 'name', direction: 'desc' }]);
    expect(toggleSort(sort, 'name')).toEqual([]);
  });

  it('puts a newly chosen key in front and keeps the rest', () => {
    const sort = toggleSort([{ field: 'name', direction: 'asc' }], 'loc.code');
    expect(sort.map((key) => key.field)).toEqual(['loc.code', 'name']);
  });
});

describe('resolveColumns', () => {
  const registry = createFieldRegistry();

  it('drops a column the registry does not know rather than failing', () => {
    expect(resolveColumns(['name', 'nope'], registry, 'project').map((f) => f.key)).toEqual([
      'name'
    ]);
  });

  it('falls back to the kind’s defaults when nothing resolves', () => {
    expect(resolveColumns(['nope'], registry, 'technology').map((f) => f.key)).toContain('ring');
  });
});

describe('palette ranking', () => {
  const item = (id: string, label: string, terms?: string): PaletteItem => ({
    id,
    label,
    group: 'Jump to',
    terms,
    run: () => {}
  });

  it('matches a subsequence and prefers adjacent, word-start hits', () => {
    expect(fuzzyScore('sidecar', 'sdc')).not.toBeNull();
    expect(fuzzyScore('sidecar', 'zz')).toBeNull();
    expect(fuzzyScore('watcher', 'watch')!).toBeGreaterThan(
      fuzzyScore('wacky-tachometer-chart', 'watch')!
    );
  });

  it('ranks an exact-ish name above a coincidental match and keeps order when empty', () => {
    const items = [item('a', 'braid'), item('b', 'ongoing'), item('c', 'roc')];
    expect(rankPalette(items, '').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(rankPalette(items, 'roc')[0].id).toBe('c');
  });

  it('searches the extra terms a caller supplies, such as a slug or a path', () => {
    const items = [item('a', 'Café Catalog', 'cafe-catalog /code/tools/cafe')];
    expect(rankPalette(items, 'cafe-cat')).toHaveLength(1);
  });
});
