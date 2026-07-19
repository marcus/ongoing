import { describe, expect, it } from 'vitest';
import { assignManualRanks, validateDecisionUpdate, validateProjectNote } from './project';

describe('project invariants', () => {
  it('assigns spaced ranks only for a complete, unique known sequence', () => {
    expect([...assignManualRanks(['b', 'a'], ['a', 'b'])]).toEqual([
      ['b', 1_000],
      ['a', 2_000]
    ]);
    expect(() => assignManualRanks(['a', 'a'], ['a', 'b'])).toThrow(/duplicate/);
    expect(() => assignManualRanks(['a', 'outside'], ['a', 'b'])).toThrow(/unknown/);
    expect(() => assignManualRanks(['a'], ['a', 'b'])).toThrow(/every visible/);
  });

  it('validates note and decision constraints at the domain boundary', () => {
    expect(() => validateProjectNote('x'.repeat(500))).not.toThrow();
    expect(() => validateProjectNote('x'.repeat(501))).toThrow(/500/);
    expect(() => validateDecisionUpdate({ intent: 'invest', excitement: 5 })).not.toThrow();
    expect(() => validateDecisionUpdate({ excitement: 0 })).toThrow(/1 through 5/);
    expect(() => validateDecisionUpdate({ strategicImportance: 2.5 })).toThrow(/integer/);
    expect(() => validateDecisionUpdate({ nextAction: 'x'.repeat(501) })).toThrow(/500/);
    expect(() => validateDecisionUpdate({ reviewAfter: 'next week' })).toThrow(/YYYY-MM-DD/);
    expect(() => validateDecisionUpdate({ reviewAfter: '2026-02-31' })).toThrow(/YYYY-MM-DD/);
    expect(() => validateDecisionUpdate({ reviewAfter: '2026-08-01' })).not.toThrow();
  });
});
