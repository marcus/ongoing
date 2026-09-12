import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './entry';
import {
  createFieldRegistry,
  FieldValidationError,
  parseFieldInput,
  validateEntryPatch,
  validateFieldDefinition
} from './fields';
import { projectProviderFields } from './provider-fields';

const registry = createFieldRegistry();

describe('validateEntryPatch', () => {
  it('splits a patch into columns and attributes by where each field lives', () => {
    expect(
      validateEntryPatch(registry, 'project', {
        name: 'Ongoing',
        note: 'the dashboard',
        intent: 'invest',
        excitement: 4,
        is_favorite: true
      })
    ).toEqual({
      columns: { name: 'Ongoing', note: 'the dashboard', is_favorite: true },
      attributes: { intent: 'invest', excitement: 4 }
    });
  });

  it('names the closest registered key when a field is unknown', () => {
    expect(() => validateEntryPatch(registry, 'project', { intnet: 'invest' })).toThrow(
      /Unknown field: intnet — did you mean intent\?/
    );
  });

  it('refuses a field that belongs to another kind, and a provider field outright', () => {
    expect(() => validateEntryPatch(registry, 'project', { ring: 'hot' })).toThrow(
      /does not apply to project entries/
    );
    expect(() => validateEntryPatch(registry, 'project', { 'github.stars': 10 })).toThrow(
      /read-only \(provider:github\)/
    );
  });

  it('enforces each type, with the message the CLI and the browser both show', () => {
    expect(() => validateEntryPatch(registry, 'project', { intent: 'invent' })).toThrow(
      /intent: must be one of invest, maintain, experiment, hibernate, archive/
    );
    expect(() => validateEntryPatch(registry, 'project', { excitement: 9 })).toThrow(
      /excitement: must be at most 5/
    );
    expect(() => validateEntryPatch(registry, 'project', { excitement: 2.5 })).toThrow(
      /must be an integer/
    );
    expect(() => validateEntryPatch(registry, 'project', { review_after: '2026-13-01' })).toThrow(
      /must be a valid YYYY-MM-DD date/
    );
    expect(() => validateEntryPatch(registry, 'project', { note: 'x'.repeat(501) })).toThrow(
      /must not exceed 500 characters/
    );
  });

  it('clears a value with null and normalises tags', () => {
    expect(validateEntryPatch(registry, 'project', { intent: null, note: null })).toEqual({
      columns: { note: '' },
      attributes: { intent: null }
    });
    expect(
      validateEntryPatch(registry, 'project', { tags: ['Infra', 'infra', ' agents '] })
    ).toEqual({ columns: { tags: ['agents', 'infra'] }, attributes: {} });
  });

  it('accepts a user field the moment it is registered', () => {
    const definition = validateFieldDefinition(registry, {
      key: 'x.customer',
      type: 'text',
      label: 'Customer'
    });
    expect(definition).toMatchObject({ key: 'x.customer', owner: 'user', storage: 'attribute' });
    const extended = createFieldRegistry([definition]);
    expect(validateEntryPatch(extended, 'project', { 'x.customer': 'acme' })).toEqual({
      columns: {},
      attributes: { 'x.customer': 'acme' }
    });
    expect(() => validateFieldDefinition(extended, { key: 'intent', type: 'text' })).toThrow(
      /already registered/
    );
    expect(() => validateFieldDefinition(registry, { key: 'Bad Key', type: 'text' })).toThrow(
      FieldValidationError
    );
    expect(() => validateFieldDefinition(registry, { key: 'x.ok', type: 'invented' })).toThrow(
      /type must be one of/
    );
  });
});

describe('parseFieldInput', () => {
  const field = (key: string) => registry.get(key)!;

  it('turns CLI strings into typed values', () => {
    expect(parseFieldInput(field('excitement'), '4')).toBe(4);
    expect(parseFieldInput(field('is_favorite'), 'true')).toBe(true);
    expect(parseFieldInput(field('intent'), 'invest')).toBe('invest');
    expect(parseFieldInput(field('tags'), 'infra,agents')).toEqual(['agents', 'infra']);
  });

  it('treats none, null, and - as "clear this field"', () => {
    for (const raw of ['none', 'null', '-', ''])
      expect(parseFieldInput(field('intent'), raw)).toBeNull();
  });
});

describe('provider projection', () => {
  it('namespaces metric and stack values so they read like any other field', () => {
    const fields = projectProviderFields(
      { commits30d: 12, githubStars: 40, tdOpenCount: 3, locCode: null } as never,
      [{ toolchain: 'go', declared: '1.27', raw: 'go 1.27', sourceFile: 'go.mod' }]
    );
    expect(fields).toEqual({
      'git.commits30d': 12,
      'github.stars': 40,
      'td.open': 3,
      'stack.go': '1.27'
    });
    expect(registry.get('github.stars')).toMatchObject({
      editable: false,
      owner: 'provider:github'
    });
  });
});

describe('slugs', () => {
  it('slugifies a name and de-duplicates within a kind', () => {
    expect(slugify('Ongoing Dashboard')).toBe('ongoing-dashboard');
    expect(slugify('café project')).toBe('cafe-project');
    expect(slugify('!!!')).toBe('entry');
    expect(uniqueSlug('td', ['td', 'td-2'])).toBe('td-3');
  });
});
