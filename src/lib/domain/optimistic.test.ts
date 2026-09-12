import { describe, expect, it } from 'vitest';
import type { EntryView } from './entry-view';
import { createFieldRegistry, FieldValidationError } from './fields';
import { applyPatch, inversePatch, reclassify } from './optimistic';

const registry = createFieldRegistry();
const NOW = Date.parse('2026-09-12T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function entry(overrides: Partial<EntryView> = {}): EntryView {
  const base: EntryView = {
    id: 'entry-1',
    kind: 'project',
    slug: 'alpha',
    name: 'alpha',
    note: 'a note',
    tags: ['tool'],
    isFavorite: false,
    isHidden: false,
    reviewAfter: null,
    path: '/code/alpha',
    isMissing: false,
    attributes: { intent: 'maintain' },
    fields: {
      kind: 'project',
      name: 'alpha',
      slug: 'alpha',
      note: 'a note',
      tags: ['tool'],
      is_favorite: false,
      is_hidden: false,
      review_after: null,
      intent: 'maintain',
      path: '/code/alpha',
      is_missing: false
    },
    views: [],
    attention: null,
    metrics: null,
    stacks: [],
    errors: [],
    technologies: [],
    sources: [],
    relations: { outgoing: [], incoming: [] },
    createdAt: ago(200),
    updatedAt: ago(1)
  };
  return { ...base, ...overrides };
}

describe('applyPatch', () => {
  it('writes a column-backed field to both the property and the flat field map', () => {
    const next = applyPatch(entry(), { is_favorite: true, note: 'rewritten' }, registry, NOW);
    expect(next.isFavorite).toBe(true);
    expect(next.fields.is_favorite).toBe(true);
    expect(next.note).toBe('rewritten');
    expect(next.fields.note).toBe('rewritten');
  });

  it('clears a column to its stored empty value rather than to null', () => {
    const next = applyPatch(entry(), { note: null, tags: null }, registry, NOW);
    expect(next.note).toBe('');
    expect(next.tags).toEqual([]);
  });

  it('removes an attribute the patch clears, so "has a value" stays a membership test', () => {
    const next = applyPatch(entry(), { intent: null }, registry, NOW);
    expect(next.attributes.intent).toBeUndefined();
    expect('intent' in next.fields).toBe(false);
  });

  it('leaves the original entry untouched, which is what makes a rollback possible', () => {
    const before = entry();
    const next = applyPatch(before, { intent: 'invest' }, registry, NOW);
    expect(before.attributes.intent).toBe('maintain');
    expect(next.attributes.intent).toBe('invest');
  });

  it('refuses what the server would refuse, with the same message', () => {
    expect(() => applyPatch(entry(), { excitement: 9 }, registry, NOW)).toThrow(
      FieldValidationError
    );
    expect(() => applyPatch(entry(), { 'github.stars': 5 }, registry, NOW)).toThrow(/read-only/);
    expect(() => applyPatch(entry(), { intnet: 'invest' }, registry, NOW)).toThrow(
      /did you mean intent/
    );
  });
});

describe('reclassify', () => {
  const missing = () =>
    entry({
      isMissing: true,
      fields: { ...entry().fields, is_missing: true }
    });

  it('puts a missing project into the attention view without asking the server', () => {
    const next = reclassify(missing(), NOW);
    expect(next.views).toContain('attention');
    expect(next.attention?.attention.reasons[0]).toMatchObject({
      input: 'isMissing',
      comparison: '=',
      threshold: true
    });
    expect(next.fields.views).toEqual(['attention']);
  });

  it('re-runs after an edit, so a decision moves a row the instant it is made', () => {
    // Everything the `dormant` rule reads: fresh git and GitHub collections, no commits, no
    // external demand, and an intent that is not `invest`.
    const dormant = entry({
      metrics: {
        latestCommitAt: ago(200),
        commits30d: 0,
        gitScannedAt: ago(0),
        githubAvailability: 'available',
        githubScannedAt: ago(0),
        githubExternalPrs: 0,
        githubExternalIssues30d: 0
      } as EntryView['metrics'],
      fields: { ...entry().fields, intent: 'maintain', 'github.starsGained30d': 0 }
    });
    const classified = reclassify(dormant, NOW);
    expect(classified.views).toContain('dormant');

    // Marking it `invest` says the quiet is deliberate, and the view drops it immediately —
    // no round trip, because the rule and everything it reads are already in the browser.
    const invested = applyPatch(classified, { intent: 'invest' }, registry, NOW);
    expect(invested.views).not.toContain('dormant');
  });

  it('says nothing about kinds the attention rules do not classify', () => {
    const technology = reclassify(entry({ kind: 'technology' }), NOW);
    expect(technology.attention).toBeNull();
    expect(technology.views).toEqual([]);
  });
});

describe('inversePatch', () => {
  it('describes the values a patch is about to replace', () => {
    expect(inversePatch(entry(), { intent: 'invest', is_favorite: true })).toEqual({
      intent: 'maintain',
      is_favorite: false
    });
  });

  it('clears a field that had no value, so undo removes what the edit added', () => {
    expect(inversePatch(entry(), { excitement: 4 })).toEqual({ excitement: null });
  });

  it('round-trips: applying a patch then its inverse restores every field', () => {
    const before = entry();
    const patch = { intent: 'invest', note: 'changed', is_favorite: true };
    const after = applyPatch(before, patch, registry, NOW);
    const restored = applyPatch(after, inversePatch(before, patch), registry, NOW);
    expect(restored.fields.intent).toBe(before.fields.intent);
    expect(restored.fields.note).toBe(before.fields.note);
    expect(restored.fields.is_favorite).toBe(before.fields.is_favorite);
  });
});
