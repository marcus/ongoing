import { describe, expect, it } from 'vitest';
import { createFieldRegistry, type FieldDefinition } from './fields';
import {
  filterRows,
  formatQuery,
  formatSort,
  legacyFilterClauses,
  legacyParamsToQuery,
  legacySortFields,
  parseColumns,
  parseQuery,
  parseSortInput,
  QueryError,
  sortRows,
  validateColumns,
  validateQuery,
  validateSort,
  type QueryRow
} from './query';

const userField: FieldDefinition = {
  key: 'x.customer',
  kinds: ['*'],
  type: 'text',
  owner: 'user',
  label: 'Customer',
  sortable: true,
  filterable: true,
  editable: true,
  required: false,
  storage: 'attribute'
};

const richField: FieldDefinition = {
  key: 'identity.logo',
  kinds: ['project'],
  type: 'json',
  owner: 'user',
  label: 'Logo',
  sortable: false,
  filterable: false,
  editable: false,
  required: false,
  storage: 'attribute',
  presentation: { adapter: 'impressions.logo.v1', role: 'identity' }
};

const registry = createFieldRegistry([userField, richField]);

function row(id: string, fields: QueryRow['fields']): QueryRow {
  return { id, fields: { kind: 'project', ...fields } };
}

const catalog: QueryRow[] = [
  row('a', {
    name: 'alpha',
    slug: 'alpha',
    path: '/code/alpha',
    note: 'release after parser cleanup',
    tags: ['archived', 'oss'],
    intent: 'invest',
    excitement: 5,
    is_favorite: true,
    'github.stars': 120,
    'git.commits30d': 18,
    'git.latestCommit': '2026-09-10T12:00:00.000Z',
    'stack.go': '1.27',
    views: ['attention', 'rising'],
    tech: ['go', 'sveltekit'],
    'identity.logo': { kind: 'impressions.logo.ref', version: 1 }
  }),
  row('b', {
    name: 'beta',
    slug: 'beta',
    path: '/code/beta',
    note: '',
    tags: ['oss'],
    intent: 'maintain',
    excitement: 2,
    is_favorite: false,
    'github.stars': 12,
    'git.commits30d': 0,
    'git.latestCommit': '2026-01-02T12:00:00.000Z',
    views: ['dormant']
  }),
  row('c', {
    name: 'gamma',
    slug: 'gamma',
    path: '/work/gamma',
    note: 'alpha channel only',
    tags: [],
    is_favorite: false,
    'git.commits30d': 7
  })
];

function ids(query: string): string[] {
  const parsed = parseQuery(query);
  validateQuery(parsed, registry);
  return filterRows(catalog, parsed, registry).map((entry) => entry.id);
}

describe('parseQuery', () => {
  it('reads every operator in the grammar', () => {
    expect(parseQuery('intent:invest').clauses[0]).toEqual({
      type: 'field',
      field: 'intent',
      alias: null,
      operator: ':',
      values: ['invest'],
      negated: false
    });
    const operators = parseQuery('a:1 b!:1 c>1 d>=1 e<1 f<=1 g:~1').clauses.map((clause) =>
      clause.type === 'field' ? clause.operator : null
    );
    expect(operators).toEqual([':', '!:', '>', '>=', '<', '<=', ':~']);
  });

  it('treats a comma as any-of and a leading dash as negation', () => {
    const [values] = parseQuery('intent:invest,maintain').clauses;
    expect(values.type === 'field' && values.values).toEqual(['invest', 'maintain']);
    const [negated] = parseQuery('-tag:archived').clauses;
    expect(negated).toMatchObject({ field: 'tags', alias: 'tag', negated: true });
  });

  it('maps tag: and view: onto their fields and leaves tech: and kind: alone', () => {
    expect(parseQuery('tag:oss view:rising tech:go kind:project').clauses).toMatchObject([
      { field: 'tags', alias: 'tag' },
      { field: 'views', alias: 'view' },
      { field: 'tech', alias: null },
      { field: 'kind', alias: null }
    ]);
  });

  it('keeps quoted text and quoted values whole', () => {
    expect(parseQuery('"parser cleanup"').clauses).toEqual([
      { type: 'text', text: 'parser cleanup', negated: false }
    ]);
    const [clause] = parseQuery('note:~"parser cleanup"').clauses;
    expect(clause.type === 'field' && clause.values).toEqual(['parser cleanup']);
    const [commas] = parseQuery('name:"a,b",c').clauses;
    expect(commas.type === 'field' && commas.values).toEqual(['a,b', 'c']);
  });

  it('falls back to bare text when the name before an operator is not a field key', () => {
    expect(parseQuery('2:30 >x :y').clauses).toEqual([
      { type: 'text', text: '2:30', negated: false },
      { type: 'text', text: '>x', negated: false },
      { type: 'text', text: ':y', negated: false }
    ]);
  });

  it('never throws, whatever it is handed', () => {
    for (const input of ['', '   ', '"', "'", '\\', '-', '--', ':::', 'a:"b', 'a\\', '>>><<<'])
      expect(() => parseQuery(input)).not.toThrow();
  });
});

describe('formatQuery', () => {
  it('prints a query back in a form that parses to the same clauses', () => {
    const samples = [
      'intent:invest,maintain github.stars>=100 -tag:archived',
      'view:upgrade tech:go',
      'note:~"parser cleanup" -"a b"',
      'name:"a,b" is_favorite:true',
      'intent:',
      'kind:technology ring:hot'
    ];
    for (const sample of samples) {
      const once = parseQuery(sample);
      expect(parseQuery(formatQuery(once))).toEqual(once);
    }
  });

  it('round-trips random clause soup without throwing (fuzz)', () => {
    // A deterministic PRNG: a failure is reproducible from the seed printed in the message.
    let seed = 0x2f6e2b1;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = [
      ...registry.fields.map((field) => field.key),
      ':',
      '!:',
      ':~',
      '>',
      '>=',
      '<',
      '<=',
      ',',
      '-',
      '*',
      '"',
      "'",
      '\\',
      ' ',
      'invest',
      'none',
      '1.27',
      '100',
      'a b',
      'привет',
      '😀'
    ];
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const length = 1 + Math.floor(random() * 12);
      let input = '';
      for (let part = 0; part < length; part += 1)
        input += alphabet[Math.floor(random() * alphabet.length)];

      const parsed = parseQuery(input);
      const printed = formatQuery(parsed);
      expect(parseQuery(printed), `input ${JSON.stringify(input)}`).toEqual(parsed);
      // Validation may reject an invented field, but it must never do anything but throw a
      // QueryError, and evaluating a validated query must never throw at all.
      try {
        validateQuery(parsed, registry);
      } catch (error) {
        expect(error, `input ${JSON.stringify(input)}`).toBeInstanceOf(QueryError);
        continue;
      }
      expect(() => filterRows(catalog, parsed, registry)).not.toThrow();
    }
  });
});

describe('validateQuery', () => {
  it('names the closest registered key for an unknown field', () => {
    expect(() => ids('intnet:invest')).toThrow(/Unknown field: intnet — did you mean intent\?/);
    expect(() => ids('x.custmer:acme')).toThrow(/did you mean x\.customer\?/);
  });

  it('refuses a field that is not filterable', () => {
    expect(() => ids('manual_rank:1')).toThrow(/manual_rank cannot be filtered/);
    expect(() => ids('identity.logo:impressions.logo.ref')).toThrow(
      /identity\.logo cannot be filtered/
    );
    expect(() => ids('identity.logo:~logo')).toThrow(/identity\.logo cannot be filtered/);
  });

  it('rejects unknown sort fields and columns the same way', () => {
    expect(() => validateSort(parseSortInput('githb.stars'), registry)).toThrow(
      /Unknown sort field: githb\.stars/
    );
    expect(() => validateSort(parseSortInput('views'), registry)).toThrow(/views cannot be sorted/);
    expect(() => validateColumns(parseColumns('name,nope'), registry)).toThrow(
      /Unknown column: nope/
    );
  });
});

describe('evaluation', () => {
  it('matches bare text against name, slug, path, and note', () => {
    expect(ids('alpha')).toEqual(['a', 'c']);
    expect(ids('/work')).toEqual(['c']);
    expect(ids('-alpha')).toEqual(['b']);
  });

  it('treats enum and multi_enum clauses as equals-any', () => {
    expect(ids('intent:invest,maintain')).toEqual(['a', 'b']);
    expect(ids('tag:oss')).toEqual(['a', 'b']);
    expect(ids('view:rising')).toEqual(['a']);
    expect(ids('tech:sveltekit')).toEqual(['a']);
  });

  it('compares numbers numerically and dates chronologically', () => {
    expect(ids('github.stars>=100')).toEqual(['a']);
    expect(ids('git.commits30d>7')).toEqual(['a']);
    expect(ids('git.commits30d>=7')).toEqual(['a', 'c']);
    expect(ids('git.latestCommit>2026-06-01')).toEqual(['a']);
    // A text comparison would put "9" above "18"; the field's integer type prevents it.
    expect(ids('git.commits30d<9')).toEqual(['b', 'c']);
  });

  it('uses :~ for contains and : for equals on text', () => {
    expect(ids('note:~parser')).toEqual(['a']);
    expect(ids('note:~PARSER')).toEqual(['a']);
    expect(ids('name:alpha')).toEqual(['a']);
    expect(ids('name:~alph')).toEqual(['a']);
  });

  it('reads booleans, * for any value, and none for no value', () => {
    expect(ids('is_favorite:true')).toEqual(['a']);
    expect(ids('is_favorite:false')).toEqual(['b', 'c']);
    expect(ids('stack.go:*')).toEqual(['a']);
    expect(ids('intent:none')).toEqual(['c']);
    expect(ids('-intent:none')).toEqual(['a', 'b']);
  });

  it('allows presence queries for rich fields without exposing their structured value', () => {
    expect(ids('identity.logo:*')).toEqual(['a']);
    expect(ids('identity.logo:none')).toEqual(['b', 'c']);
    expect(ids('identity.logo!:none')).toEqual(['a']);
  });

  it('combines clauses with AND and negates with a leading dash or !:', () => {
    expect(ids('intent:invest,maintain -tag:archived')).toEqual(['b']);
    expect(ids('intent!:invest')).toEqual(['b', 'c']);
    expect(ids('tag:oss github.stars>100')).toEqual(['a']);
  });
});

describe('sorting', () => {
  const names = (sort: string, direction?: 'asc' | 'desc'): string[] => {
    const keys = parseSortInput(sort, direction);
    validateSort(keys, registry);
    return sortRows(catalog, keys, registry).map((entry) => entry.fields.name as string);
  };

  it('sorts ascending by default and descending with a dash', () => {
    expect(names('name')).toEqual(['alpha', 'beta', 'gamma']);
    expect(names('-name')).toEqual(['gamma', 'beta', 'alpha']);
    expect(names('-git.commits30d')).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('puts missing values last in both directions', () => {
    expect(names('github.stars')).toEqual(['beta', 'alpha', 'gamma']);
    expect(names('-github.stars')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('applies several keys in order', () => {
    expect(names('-is_favorite,name')).toEqual(['alpha', 'beta', 'gamma']);
    expect(names('is_favorite,-name')).toEqual(['gamma', 'beta', 'alpha']);
    expect(formatSort(parseSortInput('-git.commits30d,name'))).toBe('-git.commits30d,name');
  });
});

/**
 * The old flag → new clause table that docs/cli.md prints. Each row here is the contract the
 * pre-Phase-2 parameters keep for one release.
 */
describe('legacy parameters', () => {
  it.each([
    [{ view: 'attention' }, 'view:attention'],
    [{ filter: 'favorites' }, 'is_favorite:true'],
    [{ filter: 'missing' }, 'is_missing:true'],
    [{ filter: 'warnings' }, 'warnings>0'],
    [{ filter: 'local' }, 'github.repoId:none'],
    [{ filter: 'all' }, ''],
    [{ stack: 'go' }, 'stack.go:*'],
    [{ tech: 'go' }, 'tech:go'],
    [{ kind: 'technology' }, 'kind:technology'],
    [{ search: 'parser' }, 'parser'],
    [{ search: 'a b' }, '"a b"'],
    [{ hidden: true }, 'is_hidden:true'],
    [{ hidden: false }, 'is_hidden:false'],
    [
      { view: 'upgrade', stack: 'go', filter: 'favorites' },
      'view:upgrade is_favorite:true stack.go:*'
    ]
  ])('maps %o onto %s', (params, expected) => {
    expect(legacyParamsToQuery(params)).toBe(expected);
  });

  it('maps every documented filter and sort key onto a registered field', () => {
    for (const clause of Object.values(legacyFilterClauses)) {
      if (!clause) continue;
      const parsed = parseQuery(clause);
      expect(() => validateQuery(parsed, registry)).not.toThrow();
    }
    for (const [alias, field] of Object.entries(legacySortFields)) {
      expect(registry.get(field), `${alias} → ${field}`).toBeDefined();
      expect(registry.get(field)?.sortable, `${alias} → ${field}`).toBe(true);
    }
  });

  it('keeps a legacy sort key descending and a field key ascending', () => {
    expect(parseSortInput('latestCommit')).toEqual([
      { field: 'git.latestCommit', direction: 'desc' }
    ]);
    expect(parseSortInput('latestCommit', 'asc')).toEqual([
      { field: 'git.latestCommit', direction: 'asc' }
    ]);
    // `name` addresses the field of the same name, so it reads as written — and so the output of
    // formatSort survives being re-parsed by the server.
    expect(parseSortInput('name')).toEqual([{ field: 'name', direction: 'asc' }]);
    expect(parseSortInput(formatSort(parseSortInput('commits30d')))).toEqual(
      parseSortInput('commits30d')
    );
  });
});
