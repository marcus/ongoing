import { describe, expect, it } from 'vitest';
import { classifyAttentionViews } from './attention';
import { describeMissing, entryCompleteness, fieldHasValue } from './completeness';
import { createFieldRegistry, validateFieldDefinition } from './fields';

const registry = createFieldRegistry();

describe('entryCompleteness', () => {
  it('scores a project against the required fields its kind declares', () => {
    // A discovered project always has kind, name, and slug; `intent` is the decision it is missing.
    const bare = entryCompleteness(registry, 'project', {
      kind: 'project',
      name: 'alpha',
      slug: 'alpha'
    });
    expect(bare.required).toEqual(['intent', 'kind', 'name', 'next_action', 'slug']);
    expect(bare.missing).toEqual(['intent', 'next_action']);
    expect(bare.complete).toBe(60);

    const decided = entryCompleteness(registry, 'project', {
      kind: 'project',
      name: 'alpha',
      slug: 'alpha',
      intent: 'invest',
      next_action: 'ship phase 6'
    });
    expect(decided.complete).toBe(100);
    expect(decided.missing).toEqual([]);
  });

  it('asks a technology for the fields a technology declares, not a project’s', () => {
    const technology = entryCompleteness(registry, 'technology', {
      kind: 'technology',
      name: 'Go',
      slug: 'go'
    });
    expect(technology.required).toEqual(['kind', 'name', 'ring', 'slug', 'technology_kind']);
    expect(technology.complete).toBe(60);
  });

  it('counts a user field that was registered as required', () => {
    const withOwner = createFieldRegistry([
      validateFieldDefinition(registry, {
        key: 'x.owner',
        type: 'text',
        kinds: ['project'],
        required: true
      })
    ]);
    expect(
      entryCompleteness(withOwner, 'project', {
        kind: 'project',
        name: 'alpha',
        slug: 'alpha',
        intent: 'invest',
        next_action: 'ship phase 6'
      }).missing
    ).toEqual(['x.owner']);
  });

  it('treats false and zero as values, and blank strings and empty lists as absences', () => {
    expect(fieldHasValue(false)).toBe(true);
    expect(fieldHasValue(0)).toBe(true);
    expect(fieldHasValue('')).toBe(false);
    expect(fieldHasValue([])).toBe(false);
    expect(fieldHasValue(null)).toBe(false);
    expect(fieldHasValue(undefined)).toBe(false);
  });

  it('names the missing fields the way the fact sheet labels them', () => {
    expect(describeMissing(registry, ['intent', 'x.nothing'])).toBe('Intent, x.nothing');
  });
});

describe('the incomplete-invest attention reason', () => {
  const base = {
    id: 'entry-1',
    isMissing: false,
    metrics: null,
    stacks: [],
    errors: [],
    githubStarsGained30d: null,
    githubTrafficViewsDelta30d: null,
    githubTrafficClonesDelta30d: null
  };
  const incomplete = {
    complete: 75,
    required: ['intent', 'next_action'],
    missing: ['next_action']
  };

  it('asks for attention when a project someone committed to has gaps', () => {
    const classified = classifyAttentionViews({
      ...base,
      intent: 'invest',
      completeness: incomplete
    });
    expect(classified.attention.member).toBe(true);
    expect(classified.attention.reasons).toContainEqual({
      source: 'decision',
      message: 'Marked invest, but next_action is not filled in',
      input: 'complete',
      value: 75,
      comparison: '<',
      threshold: 100
    });
  });

  it('says nothing about an incomplete project nobody committed to', () => {
    expect(
      classifyAttentionViews({ ...base, intent: 'maintain', completeness: incomplete }).attention
        .member
    ).toBe(false);
    expect(
      classifyAttentionViews({ ...base, intent: null, completeness: incomplete }).attention.member
    ).toBe(false);
  });

  it('stays silent when the registry was not in hand, rather than claiming a gap', () => {
    expect(classifyAttentionViews({ ...base, intent: 'invest' }).attention.member).toBe(false);
  });
});
