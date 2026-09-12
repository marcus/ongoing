import type { AttributeValue } from './entry';
import type { FieldDefinition, FieldRegistry } from './fields';

/**
 * One query grammar, parsed and evaluated by pure functions, shared verbatim by the HTTP API, the
 * CLI, and the browser (ADR 0006).
 *
 * ```
 * filter   := clause (' ' clause)*
 * clause   := ['-'] (field op value | 'tag:' value | 'view:' value | 'tech:' slug | 'kind:' kind | text)
 * op       := ':' | '!:' | '>' | '>=' | '<' | '<=' | ':~'
 * value    := token | token ',' token ...
 * sort     := ['-'] field (',' ['-'] field)*
 * ```
 *
 * Clauses combine with AND; a comma inside a value is OR; a leading `-` negates the clause. Bare
 * text searches name, slug, path, and note. `tag:` and `view:` are singular aliases for the `tags`
 * and `views` fields; `tech:` and `kind:` are ordinary fields, so every clause in the grammar is a
 * field clause and the evaluator has exactly one shape to handle.
 *
 * Parsing is **total**: any string produces a query. Everything that can fail — an unknown field, a
 * field that cannot be filtered or sorted — fails in {@link validateQuery}, {@link validateSort},
 * and {@link validateColumns} against the registry, which is what makes a fuzz test meaningful and
 * what lets the browser parse as the user types and only validate on submit.
 */
export const queryOperators = ['!:', ':~', '>=', '<=', ':', '>', '<'] as const;

export type QueryOperator = (typeof queryOperators)[number];

/** Tokens that mean "this field has no value". `*` is their opposite: "has any value". */
export const EMPTY_TOKENS = ['', 'none', 'null'] as const;
export const ANY_TOKEN = '*';

/** Bare text is matched against these fields, in this order (ADR 0006). */
export const TEXT_SEARCH_FIELDS = ['name', 'slug', 'path', 'note'] as const;

/** `tag:` and `view:` read better in the singular than the fields they address. */
export const clauseAliases: Readonly<Record<string, string>> = { tag: 'tags', view: 'views' };

export class QueryError extends Error {
  constructor(
    message: string,
    readonly token?: string
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export interface FieldClause {
  type: 'field';
  field: string;
  /** The word the clause was written with, when it differs from the field (`tag` for `tags`). */
  alias: string | null;
  operator: QueryOperator;
  values: string[];
  negated: boolean;
}

export interface TextClause {
  type: 'text';
  text: string;
  negated: boolean;
}

export type QueryClause = FieldClause | TextClause;

export interface ParsedQuery {
  clauses: QueryClause[];
}

/** Anything the evaluator can filter: an id and the flat field map the read model produces. */
export interface QueryRow {
  id: string;
  fields: Record<string, AttributeValue>;
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/* ------------------------------------------------------------------ parsing */

/** Splits on whitespace that is not inside quotes, keeping quote characters for the value parser. */
function splitTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaped = false;
  let started = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function unquote(value: string): string {
  let result = '';
  let quote: string | null = null;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else result += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    result += char;
  }
  return result;
}

function findOperator(token: string): { index: number; operator: QueryOperator } | null {
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '!' && token[index + 1] === ':') return { index, operator: '!:' };
    if (char === ':') return { index, operator: token[index + 1] === '~' ? ':~' : ':' };
    if (char === '>') return { index, operator: token[index + 1] === '=' ? '>=' : '>' };
    if (char === '<') return { index, operator: token[index + 1] === '=' ? '<=' : '<' };
  }
  return null;
}

/** Splits a value on commas that are not inside quotes, then strips the quoting. */
function splitValues(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaped = false;
  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map(unquote);
}

/** Total: every string is a query. Field keys are resolved against the registry separately. */
export function parseQuery(input: string): ParsedQuery {
  const clauses: QueryClause[] = [];
  for (const raw of splitTokens(input ?? '')) {
    let token = raw;
    let negated = false;
    if (token.startsWith('-') && token.length > 1) {
      negated = true;
      token = token.slice(1);
    }
    const found = findOperator(token);
    const name = found ? token.slice(0, found.index) : '';
    if (found && FIELD_KEY.test(name)) {
      const field = clauseAliases[name] ?? name;
      clauses.push({
        type: 'field',
        field,
        alias: field === name ? null : name,
        operator: found.operator,
        values: splitValues(token.slice(found.index + found.operator.length)),
        negated
      });
      continue;
    }
    const text = unquote(token);
    if (text) clauses.push({ type: 'text', text, negated });
  }
  return { clauses };
}

function quoteIfNeeded(value: string, leadingDashMatters = false): string {
  if (value === '') return '""';
  const needs =
    /[\s,"']/.test(value) || (leadingDashMatters && value.startsWith('-')) || /[:><!]/.test(value);
  if (!needs) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

export function formatClause(clause: QueryClause): string {
  const prefix = clause.negated ? '-' : '';
  if (clause.type === 'text') return prefix + quoteIfNeeded(clause.text, true);
  const name = clause.alias ?? clause.field;
  return `${prefix}${name}${clause.operator}${clause.values.map((value) => quoteIfNeeded(value)).join(',')}`;
}

/** Prints a query back. `parse(print(parse(s)))` equals `parse(s)` for every string. */
export function formatQuery(query: ParsedQuery): string {
  return query.clauses.map(formatClause).join(' ');
}

/* --------------------------------------------------------------- validation */

function unknownField(
  registry: FieldRegistry,
  key: string,
  kind: string | undefined,
  what: string
) {
  const suggestion = registry.suggest(key, kind);
  return new QueryError(
    `Unknown ${what}: ${key}${suggestion ? ` — did you mean ${suggestion}?` : ''}`,
    key
  );
}

/** Throws {@link QueryError} with the message the CLI and the UI both show. */
export function validateQuery(query: ParsedQuery, registry: FieldRegistry, kind?: string): void {
  for (const clause of query.clauses) {
    if (clause.type !== 'field') continue;
    const definition = registry.get(clause.field);
    if (!definition) throw unknownField(registry, clause.field, kind, 'field');
    if (!definition.filterable)
      throw new QueryError(`Field ${clause.field} cannot be filtered`, clause.field);
  }
}

export interface SortKey {
  field: string;
  direction: 'asc' | 'desc';
}

/** Total, like {@link parseQuery}: `-git.commits30d,name` becomes two keys. */
export function parseSort(input: string): SortKey[] {
  return (input ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.startsWith('-')
        ? { field: part.slice(1), direction: 'desc' as const }
        : { field: part.startsWith('+') ? part.slice(1) : part, direction: 'asc' as const }
    )
    .filter((key) => key.field.length > 0);
}

export function formatSort(keys: readonly SortKey[]): string {
  return keys.map((key) => `${key.direction === 'desc' ? '-' : ''}${key.field}`).join(',');
}

export function validateSort(
  keys: readonly SortKey[],
  registry: FieldRegistry,
  kind?: string
): void {
  for (const key of keys) {
    const definition = registry.get(key.field);
    if (!definition) throw unknownField(registry, key.field, kind, 'sort field');
    if (!definition.sortable)
      throw new QueryError(`Field ${key.field} cannot be sorted`, key.field);
  }
}

export function parseColumns(input: string): string[] {
  return (input ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateColumns(
  columns: readonly string[],
  registry: FieldRegistry,
  kind?: string
): void {
  for (const column of columns)
    if (!registry.get(column)) throw unknownField(registry, column, kind, 'column');
}

/* --------------------------------------------------------------- evaluation */

function isEmpty(value: AttributeValue | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function lower(value: string): string {
  return value.toLocaleLowerCase('en');
}

function stringify(value: AttributeValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function booleanToken(token: string): boolean | null {
  const text = lower(token);
  if (text === 'true' || text === 'yes' || text === '1') return true;
  if (text === 'false' || text === 'no' || text === '0') return false;
  return null;
}

function equalsScalar(definition: FieldDefinition, value: AttributeValue, token: string): boolean {
  switch (definition.type) {
    case 'boolean': {
      const wanted = booleanToken(token);
      return wanted === null ? false : Boolean(value) === wanted;
    }
    case 'number':
    case 'integer': {
      const wanted = Number(token);
      return Number.isFinite(wanted) && Number(value) === wanted;
    }
    default:
      return lower(stringify(value)) === lower(token);
  }
}

/** `:` — equals any of the tokens, with `*` meaning "has a value" and `none` meaning "has not". */
function equalsToken(
  definition: FieldDefinition,
  value: AttributeValue | undefined,
  token: string
): boolean {
  if (token === ANY_TOKEN) return !isEmpty(value);
  if ((EMPTY_TOKENS as readonly string[]).includes(lower(token))) return isEmpty(value);
  if (isEmpty(value)) return false;
  if (Array.isArray(value)) return value.some((item) => equalsScalar(definition, item, token));
  return equalsScalar(definition, value as AttributeValue, token);
}

/** Field types drive comparison: numbers numerically, dates chronologically, the rest by text. */
function compareToken(
  definition: FieldDefinition,
  value: AttributeValue | undefined,
  token: string
): number | null {
  if (isEmpty(value) || Array.isArray(value) || typeof value === 'object') return null;
  switch (definition.type) {
    case 'number':
    case 'integer': {
      const right = Number(token);
      const left = Number(value);
      return Number.isFinite(right) && Number.isFinite(left) ? left - right : null;
    }
    case 'boolean': {
      const right = booleanToken(token);
      return right === null ? null : Number(Boolean(value)) - Number(right);
    }
    case 'date': {
      const right = Date.parse(token);
      const left = Date.parse(String(value));
      return Number.isFinite(right) && Number.isFinite(left) ? left - right : null;
    }
    default: {
      // ISO timestamps living in text fields (`git.latestCommit`) compare chronologically as text.
      return String(value).localeCompare(token, 'en', { sensitivity: 'base', numeric: true });
    }
  }
}

function matchFieldClause(
  definition: FieldDefinition,
  value: AttributeValue | undefined,
  clause: FieldClause
): boolean {
  switch (clause.operator) {
    case ':':
    case '!:': {
      const hit = clause.values.some((token) => equalsToken(definition, value, token));
      return clause.operator === ':' ? hit : !hit;
    }
    case ':~': {
      const haystack = lower(stringify(value));
      return clause.values.some((token) => token !== '' && haystack.includes(lower(token)));
    }
    default:
      return clause.values.some((token) => {
        const comparison = compareToken(definition, value, token);
        if (comparison === null) return false;
        if (clause.operator === '>') return comparison > 0;
        if (clause.operator === '>=') return comparison >= 0;
        if (clause.operator === '<') return comparison < 0;
        return comparison <= 0;
      });
  }
}

function matchTextClause(row: QueryRow, clause: TextClause): boolean {
  const needle = lower(clause.text);
  return TEXT_SEARCH_FIELDS.some((key) => lower(stringify(row.fields[key])).includes(needle));
}

/** One row against a validated query. Unknown fields never reach here; validate first. */
export function matchesQuery(row: QueryRow, query: ParsedQuery, registry: FieldRegistry): boolean {
  for (const clause of query.clauses) {
    let hit: boolean;
    if (clause.type === 'text') hit = matchTextClause(row, clause);
    else {
      const definition = registry.get(clause.field);
      if (!definition) return false;
      hit = matchFieldClause(definition, row.fields[clause.field], clause);
    }
    if (clause.negated ? hit : !hit) return false;
  }
  return true;
}

export function filterRows<Row extends QueryRow>(
  rows: readonly Row[],
  query: ParsedQuery,
  registry: FieldRegistry
): Row[] {
  return rows.filter((row) => matchesQuery(row, query, registry));
}

function sortValue(value: AttributeValue | undefined): string | number | boolean | null {
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

/** Missing values sort last in both directions: absence is not a small number. */
function compareForSort(
  definition: FieldDefinition | undefined,
  left: AttributeValue | undefined,
  right: AttributeValue | undefined,
  direction: 'asc' | 'desc'
): number {
  const a = sortValue(left);
  const b = sortValue(right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  let comparison: number;
  if (definition?.type === 'number' || definition?.type === 'integer')
    comparison = Number(a) - Number(b);
  else if (typeof a === 'boolean' || typeof b === 'boolean')
    comparison = Number(Boolean(a)) - Number(Boolean(b));
  else if (typeof a === 'number' && typeof b === 'number') comparison = a - b;
  else comparison = String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
  return direction === 'asc' ? comparison : -comparison;
}

export function sortRows<Row extends QueryRow>(
  rows: readonly Row[],
  keys: readonly SortKey[],
  registry: FieldRegistry
): Row[] {
  if (!keys.length) return [...rows];
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const comparison = compareForSort(
        registry.get(key.field),
        left.fields[key.field],
        right.fields[key.field],
        key.direction
      );
      if (comparison !== 0) return comparison;
    }
    const byName = stringify(left.fields.name).localeCompare(stringify(right.fields.name), 'en', {
      sensitivity: 'base'
    });
    return byName !== 0 ? byName : left.id.localeCompare(right.id, 'en');
  });
}

/* ------------------------------------------------------- legacy translation */

/**
 * The pre-Phase-2 list parameters, expressed as clauses. One table, used by `/api/entries` and by
 * `ongoing list`, so the old flags keep working and the mapping is testable in one place
 * (docs/cli.md prints this table).
 */
export const legacyFilterClauses: Readonly<Record<string, string>> = {
  all: '',
  favorites: 'is_favorite:true',
  missing: 'is_missing:true',
  // Narrower than the old filter, which also matched anything in `view:attention`. The grammar has
  // no OR between clauses by design (ADR 0006); `view:attention` is the other half.
  warnings: 'warnings>0',
  local: 'github.repoId:none'
};

/** Old `--sort` keys, and the registered field each one addressed. */
export const legacySortFields: Readonly<Record<string, string>> = {
  manual: 'manual_rank',
  latestCommit: 'git.latestCommit',
  commits30d: 'git.commits30d',
  activeDays30d: 'git.activeDays30d',
  linesOfCode: 'loc.code',
  lifetimeCommits: 'git.commitCount',
  openTdIssues: 'td.total',
  githubStars: 'github.stars',
  githubStarsGained30d: 'github.starsGained30d',
  githubOpenPrs: 'github.openPrs',
  githubOldestExternalPr: 'github.oldestExternalPr',
  githubTraffic: 'github.trafficViews',
  stackLag: 'stack.lag',
  name: 'name'
};

export interface LegacyListParams {
  kind?: string | null;
  view?: string | null;
  filter?: string | null;
  stack?: string | null;
  search?: string | null;
  /** `true` narrows to the hidden shelf, `false` excludes it, `undefined` leaves it alone. */
  hidden?: boolean;
  tech?: string | null;
}

export function legacyParamsToQuery(params: LegacyListParams): string {
  const clauses: string[] = [];
  if (params.kind) clauses.push(`kind:${params.kind}`);
  if (params.view) clauses.push(`view:${params.view}`);
  if (params.filter && legacyFilterClauses[params.filter])
    clauses.push(legacyFilterClauses[params.filter]);
  if (params.stack) clauses.push(`stack.${params.stack}:${ANY_TOKEN}`);
  if (params.tech) clauses.push(`tech:${params.tech}`);
  if (params.hidden !== undefined) clauses.push(`is_hidden:${params.hidden}`);
  if (params.search) clauses.push(quoteIfNeeded(params.search, true));
  return clauses.filter(Boolean).join(' ');
}

/**
 * One `--sort` / `?sort=` parser for both eras. A `-` or `+` prefix always wins; without one,
 * `direction` decides; failing that, a **legacy alias** keeps the descending default `?dir=` used
 * to supply, and a field key sorts ascending as written.
 *
 * "Legacy alias" means a name that is not itself a field key — `latestCommit`, `commits30d`,
 * `stackLag`. `name` appears in the table but addresses the field of the same name, so it takes
 * the field rule and sorts A→Z. That distinction is what makes the output of {@link formatSort}
 * safe to re-parse: the CLI resolves a user's flags into field keys and the server re-reads them
 * without the legacy default flipping their direction a second time.
 */
export function parseSortInput(
  input: string | null | undefined,
  direction?: 'asc' | 'desc'
): SortKey[] {
  return (input ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const explicit = part.startsWith('-') ? 'desc' : part.startsWith('+') ? 'asc' : null;
      const name = explicit ? part.slice(1) : part;
      const target = legacySortFields[name];
      const isAlias = target !== undefined && target !== name;
      return {
        field: target ?? name,
        direction: explicit ?? direction ?? (isAlias ? ('desc' as const) : ('asc' as const))
      };
    })
    .filter((key) => key.field.length > 0);
}
