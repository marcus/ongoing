import {
  ENTRY_NAME_MAX_LENGTH,
  ENTRY_NOTE_MAX_LENGTH,
  normalizeTags,
  validateSlug,
  type AttributeValue
} from './entry';
import { fieldsForProviders, providerFieldDefinitions } from './provider';
import { technologyKinds, technologyRings } from './technology';

/**
 * The field registry. Every value an entry carries — in a column, in its `attributes` document, or
 * projected from a provider's metric table — is described by one of these definitions, and
 * `validateEntryPatch` is the only path that turns an untrusted patch into stored values. The API,
 * the CLI, and the browser all run this same function (ADR 0005).
 */
export const fieldTypes = [
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'url',
  'enum',
  'multi_enum',
  'json'
] as const;

export type FieldType = (typeof fieldTypes)[number];

/** `core` is declared in code, `user` is a row in `fields`, `provider:<name>` is read-only. */
export type FieldOwner = 'core' | 'user' | `provider:${string}`;

export interface FieldOptions {
  /** Permitted values for `enum` and `multi_enum`. Absent on `multi_enum` means free-form. */
  values?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
}

/**
 * Where a value physically lives. Callers never see this — it exists so the repository can apply a
 * validated patch without re-deriving which keys are columns.
 */
export type FieldStorage = 'column' | 'attribute' | 'projected';

export interface FieldDefinition {
  key: string;
  /** The entry kinds that carry this field, or `['*']` for every kind. */
  kinds: readonly string[];
  type: FieldType;
  options?: FieldOptions;
  owner: FieldOwner;
  label: string;
  description?: string;
  sortable: boolean;
  filterable: boolean;
  editable: boolean;
  /** Counts toward completeness for its kinds. */
  required: boolean;
  storage: FieldStorage;
  /** Column name for `storage: 'column'`. */
  column?: string;
}

export class FieldValidationError extends Error {
  constructor(
    message: string,
    readonly key?: string
  ) {
    super(message);
    this.name = 'FieldValidationError';
  }
}

function core(definition: Omit<FieldDefinition, 'owner'>): FieldDefinition {
  return { owner: 'core', ...definition };
}

/**
 * Built-in fields, declared in code rather than seeded as rows so that a fresh database and an
 * upgraded one agree without a data migration.
 */
export const builtinFields: readonly FieldDefinition[] = [
  core({
    key: 'name',
    kinds: ['*'],
    type: 'text',
    options: { maxLength: ENTRY_NAME_MAX_LENGTH },
    label: 'Name',
    sortable: true,
    filterable: true,
    editable: true,
    required: true,
    storage: 'column',
    column: 'name'
  }),
  core({
    key: 'kind',
    kinds: ['*'],
    type: 'text',
    label: 'Kind',
    description: 'project, technology, …; set when the entry is created and never patched',
    sortable: true,
    filterable: true,
    editable: false,
    required: true,
    storage: 'column',
    column: 'kind'
  }),
  core({
    key: 'slug',
    kinds: ['*'],
    type: 'text',
    label: 'Slug',
    description: 'URL and CLI handle, unique within the kind',
    sortable: true,
    filterable: true,
    editable: true,
    required: true,
    storage: 'column',
    column: 'slug'
  }),
  core({
    key: 'note',
    kinds: ['*'],
    type: 'text',
    options: { maxLength: ENTRY_NOTE_MAX_LENGTH },
    label: 'Note',
    sortable: false,
    filterable: true,
    editable: true,
    required: false,
    storage: 'column',
    column: 'note'
  }),
  core({
    key: 'tags',
    kinds: ['*'],
    type: 'multi_enum',
    label: 'Tags',
    description: 'Free-form labels; any value is allowed',
    sortable: false,
    filterable: true,
    editable: true,
    required: false,
    storage: 'column',
    column: 'tags'
  }),
  core({
    key: 'is_favorite',
    kinds: ['*'],
    type: 'boolean',
    label: 'Favorite',
    sortable: true,
    filterable: true,
    editable: true,
    required: false,
    storage: 'column',
    column: 'is_favorite'
  }),
  core({
    key: 'is_hidden',
    kinds: ['*'],
    type: 'boolean',
    label: 'Hidden',
    sortable: true,
    filterable: true,
    editable: true,
    required: false,
    storage: 'column',
    column: 'is_hidden'
  }),
  core({
    key: 'review_after',
    kinds: ['*'],
    type: 'date',
    label: 'Review after',
    description: 'Date after which this entry’s decisions count as stale',
    sortable: true,
    filterable: true,
    editable: true,
    required: false,
    storage: 'column',
    column: 'review_after'
  }),
  core({
    key: 'intent',
    kinds: ['project'],
    type: 'enum',
    options: { values: ['invest', 'maintain', 'experiment', 'hibernate', 'archive'] },
    label: 'Intent',
    sortable: true,
    filterable: true,
    editable: true,
    required: true,
    storage: 'attribute'
  }),
  core({
    key: 'excitement',
    kinds: ['project'],
    type: 'integer',
    options: { min: 1, max: 5 },
    label: 'Excitement',
    sortable: true,
    filterable: true,
    editable: true,
    required: false,
    storage: 'attribute'
  }),
  core({
    key: 'strategic_importance',
    kinds: ['project'],
    type: 'integer',
    options: { min: 1, max: 5 },
    label: 'Strategic importance',
    sortable: true,
    filterable: true,
    editable: true,
    required: false,
    storage: 'attribute'
  }),
  core({
    key: 'next_action',
    kinds: ['project'],
    type: 'text',
    options: { maxLength: 500 },
    label: 'Next action',
    sortable: false,
    filterable: true,
    editable: true,
    required: false,
    storage: 'attribute'
  }),
  core({
    key: 'manual_rank',
    kinds: ['*'],
    type: 'integer',
    options: { min: 1 },
    label: 'Manual rank',
    description: 'Sparse sort key; reorder assigns multiples of 1000',
    sortable: true,
    filterable: false,
    editable: true,
    required: false,
    storage: 'attribute'
  }),
  core({
    key: 'technology_kind',
    kinds: ['technology'],
    type: 'enum',
    options: { values: technologyKinds },
    label: 'Technology kind',
    sortable: true,
    filterable: true,
    editable: true,
    required: true,
    storage: 'attribute'
  }),
  core({
    key: 'ring',
    kinds: ['technology'],
    type: 'enum',
    options: { values: technologyRings },
    label: 'Ring',
    description: 'How much this technology is the default choice today; `review_after` ages it',
    sortable: true,
    filterable: true,
    editable: true,
    required: true,
    storage: 'attribute'
  }),
  core({
    key: 'tool_surface',
    kinds: ['technology'],
    type: 'text',
    options: { maxLength: 200 },
    label: 'Tool surface',
    description: 'One line describing what an agent can do with it',
    sortable: false,
    filterable: true,
    editable: true,
    required: false,
    storage: 'attribute'
  })
];

export interface FieldRegistry {
  readonly fields: readonly FieldDefinition[];
  get(key: string): FieldDefinition | undefined;
  forKind(kind: string): FieldDefinition[];
  /** The closest registered key to a typo, for error messages. */
  suggest(key: string, kind?: string): string | null;
}

export function fieldAppliesTo(definition: FieldDefinition, kind: string): boolean {
  return definition.kinds.includes('*') || definition.kinds.includes(kind);
}

export interface FieldRegistryOptions {
  /**
   * The providers whose manifests contribute fields. Omitted means every shipped provider, which is
   * what a caller that has no configuration in hand (a test, the browser) should see; the server
   * passes the enabled, available set so a disabled provider registers nothing (ADR 0007).
   */
  providers?: readonly string[];
}

export function createFieldRegistry(
  userFields: readonly FieldDefinition[] = [],
  options: FieldRegistryOptions = {}
): FieldRegistry {
  const byKey = new Map<string, FieldDefinition>();
  const fromProviders = options.providers
    ? fieldsForProviders(options.providers)
    : providerFieldDefinitions;
  for (const definition of [...builtinFields, ...fromProviders, ...userFields])
    byKey.set(definition.key, definition);
  const fields = [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key, 'en'));
  return {
    fields,
    get: (key) => byKey.get(key),
    forKind: (kind) => fields.filter((definition) => fieldAppliesTo(definition, kind)),
    suggest(key, kind) {
      const candidates = (kind ? this.forKind(kind) : [...fields]).map((field) => field.key);
      let best: string | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const score = editDistance(key, candidate);
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return bestScore <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
    }
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const next = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
      diagonal = previous[column];
      previous[column] = next;
    }
  }
  return previous[right.length];
}

/** A validated patch, split by where each value has to be written. */
export interface EntryPatch {
  columns: Record<string, AttributeValue>;
  /** A null value clears the attribute rather than storing null. */
  attributes: Record<string, AttributeValue>;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function coerceFieldValue(definition: FieldDefinition, value: unknown): AttributeValue {
  const fail = (message: string): never => {
    throw new FieldValidationError(`${definition.key}: ${message}`, definition.key);
  };
  if (value === null || value === undefined) return null;

  switch (definition.type) {
    case 'text':
    case 'url': {
      if (typeof value !== 'string') return fail('must be a string');
      const text = value;
      if (!text) return null;
      const max = definition.options?.maxLength;
      if (max !== undefined && text.length > max) return fail(`must not exceed ${max} characters`);
      if (definition.type === 'url' && !/^https?:\/\/\S+$/.test(text))
        return fail('must be an http or https URL');
      return text;
    }
    case 'number':
    case 'integer': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (typeof value !== 'number' && typeof value !== 'string') return fail('must be a number');
      if (!Number.isFinite(numeric)) return fail('must be a number');
      if (definition.type === 'integer' && !Number.isInteger(numeric))
        return fail('must be an integer');
      const { min, max } = definition.options ?? {};
      if (min !== undefined && numeric < min) return fail(`must be at least ${min}`);
      if (max !== undefined && numeric > max) return fail(`must be at most ${max}`);
      return numeric;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'yes' || value === '1') return true;
      if (value === 'false' || value === 'no' || value === '0') return false;
      return fail('must be true or false');
    }
    case 'date': {
      if (typeof value !== 'string' || !isoDate.test(value))
        return fail('must be a YYYY-MM-DD date');
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
        return fail('must be a valid YYYY-MM-DD date');
      return value;
    }
    case 'enum': {
      const values = definition.options?.values ?? [];
      if (typeof value !== 'string' || !values.includes(value))
        return fail(`must be one of ${values.join(', ')}`);
      return value;
    }
    case 'multi_enum': {
      const list = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : fail('must be an array of strings');
      const values = definition.options?.values;
      const normalized = (list as unknown[]).map((item) => {
        if (typeof item !== 'string') return fail('must be an array of strings');
        if (values && !values.includes(item)) return fail(`must contain only ${values.join(', ')}`);
        return item;
      }) as string[];
      return definition.key === 'tags' ? normalizeTags(normalized) : normalized;
    }
    case 'json': {
      if (typeof value !== 'object' || Array.isArray(value)) return fail('must be a JSON object');
      return value as Record<string, unknown>;
    }
  }
}

/**
 * The one path from an untrusted patch to stored values. Keys are field keys (`intent`,
 * `x.customer`, `note`); a null value clears the field. Throws {@link FieldValidationError} with the
 * closest registered key when a key is unknown, so the CLI, the API, and the browser all say the
 * same thing.
 */
export function validateEntryPatch(
  registry: FieldRegistry,
  kind: string,
  patch: Record<string, unknown>
): EntryPatch {
  const result: EntryPatch = { columns: {}, attributes: {} };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const definition = registry.get(key);
    if (!definition) {
      const suggestion = registry.suggest(key, kind);
      throw new FieldValidationError(
        `Unknown field: ${key}${suggestion ? ` — did you mean ${suggestion}?` : ''}`,
        key
      );
    }
    if (!fieldAppliesTo(definition, kind))
      throw new FieldValidationError(`Field ${key} does not apply to ${kind} entries`, key);
    if (!definition.editable || definition.storage === 'projected')
      throw new FieldValidationError(`Field ${key} is read-only (${definition.owner})`, key);

    const value = coerceFieldValue(definition, raw);
    if (definition.storage === 'column') {
      if (definition.key === 'slug') {
        if (typeof value !== 'string') throw new FieldValidationError('slug is required', key);
        validateSlug(value);
      }
      if (definition.key === 'name' && (typeof value !== 'string' || !value.trim()))
        throw new FieldValidationError('name must not be empty', key);
      if (definition.key === 'note' && value === null) result.columns.note = '';
      else if (definition.key === 'tags' && value === null) result.columns.tags = [];
      else result.columns[definition.column ?? definition.key] = value;
    } else {
      result.attributes[definition.key] = value;
    }
  }
  return result;
}

/** Parses a CLI string into the field's type, treating `none`, `null`, and `-` as "clear". */
export function parseFieldInput(definition: FieldDefinition, raw: string): AttributeValue {
  if (raw === '' || raw === 'none' || raw === 'null' || raw === '-') return null;
  if (definition.type === 'json') {
    try {
      return coerceFieldValue(definition, JSON.parse(raw));
    } catch (error) {
      if (error instanceof FieldValidationError) throw error;
      throw new FieldValidationError(`${definition.key}: must be valid JSON`, definition.key);
    }
  }
  return coerceFieldValue(definition, raw);
}

const userFieldKey = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/** Validates a user-defined field before it becomes a row in `fields`. */
export function validateFieldDefinition(
  registry: FieldRegistry,
  input: Record<string, unknown>
): FieldDefinition {
  const key = String(input.key ?? '').trim();
  if (!userFieldKey.test(key))
    throw new FieldValidationError(
      'Field keys are lowercase words, optionally namespaced with dots (for example x.customer)',
      key
    );
  if (registry.get(key)) throw new FieldValidationError(`Field already registered: ${key}`, key);
  const type = String(input.type ?? '') as FieldType;
  if (!fieldTypes.includes(type))
    throw new FieldValidationError(`type must be one of ${fieldTypes.join(', ')}`, key);

  const kinds = input.kinds === undefined ? ['*'] : input.kinds;
  if (!Array.isArray(kinds) || kinds.some((kind) => typeof kind !== 'string' || !kind))
    throw new FieldValidationError('kinds must be an array of entry kinds, or ["*"]', key);

  const options: FieldOptions = {};
  const raw = (input.options ?? {}) as Record<string, unknown>;
  if (raw.values !== undefined) {
    if (!Array.isArray(raw.values) || raw.values.some((value) => typeof value !== 'string'))
      throw new FieldValidationError('options.values must be an array of strings', key);
    options.values = raw.values as string[];
  }
  for (const numeric of ['min', 'max', 'maxLength'] as const) {
    if (raw[numeric] === undefined) continue;
    if (typeof raw[numeric] !== 'number' || !Number.isFinite(raw[numeric]))
      throw new FieldValidationError(`options.${numeric} must be a number`, key);
    options[numeric] = raw[numeric];
  }
  if (
    (type === 'enum' || (type === 'multi_enum' && raw.values !== undefined)) &&
    !options.values?.length
  )
    throw new FieldValidationError('enum fields need options.values', key);

  const boolean = (name: string, fallback: boolean): boolean => {
    const value = input[name];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean')
      throw new FieldValidationError(`${name} must be a boolean`, key);
    return value;
  };

  return {
    key,
    kinds: kinds as string[],
    type,
    options: Object.keys(options).length ? options : undefined,
    owner: 'user',
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : key,
    description: typeof input.description === 'string' ? input.description : undefined,
    sortable: boolean('sortable', true),
    filterable: boolean('filterable', true),
    editable: true,
    required: boolean('required', false),
    storage: 'attribute'
  };
}

/** The registry as the API and CLI see it — the storage layout stays inside the repository. */
export function describeField(definition: FieldDefinition): Omit<FieldDefinition, 'column'> {
  const described: Record<string, unknown> = { ...definition };
  delete described.column;
  return described as Omit<FieldDefinition, 'column'>;
}
