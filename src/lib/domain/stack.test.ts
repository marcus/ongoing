import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  normalizeVersion,
  parseVersion,
  resolveStack,
  stackLag,
  type DeclaredStack,
  type ToolchainRelease
} from './stack';

const NOW = Date.parse('2026-07-30T00:00:00.000Z');
const FETCHED = '2026-07-29T00:00:00.000Z';

function cycle(
  cycleName: string,
  options: Partial<Omit<ToolchainRelease, 'cycle' | 'toolchain'>> = {}
): ToolchainRelease {
  return {
    toolchain: 'go',
    cycle: cycleName,
    latest: `${cycleName}.9`,
    releaseDate: null,
    eolFrom: null,
    isEol: false,
    isMaintained: true,
    isLts: false,
    fetchedAt: FETCHED,
    ...options
  };
}

function declared(version: string, raw = version): DeclaredStack {
  return { toolchain: 'go', declared: version, raw, sourceFile: 'go.mod' };
}

describe('version parsing', () => {
  it.each([
    ['1.22', [1, 22]],
    ['v20', [20]],
    ['>=20', [20]],
    ['^1.22', [1, 22]],
    ['~3.12', [3, 12]],
    ['20.x', [20]],
    ['22-alpine', [22]],
    ['node:22-alpine', [22]],
    ['1.22.0-rc1', [1, 22, 0]],
    ['>=18 <21', [18]],
    ['3.13.5', [3, 13, 5]]
  ])('parses %s', (raw, expected) => {
    expect(parseVersion(raw)).toEqual(expected);
  });

  it('returns null when there is no version at all', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(normalizeVersion('stable')).toBe('');
    expect(normalizeVersion('>=20')).toBe('20');
  });

  it('compares segment by segment, treating missing segments as zero', () => {
    expect(compareVersions([1, 22], [1, 22, 0])).toBe(0);
    expect(compareVersions([1, 9], [1, 22])).toBeLessThan(0);
    expect(compareVersions([2], [1, 99])).toBeGreaterThan(0);
  });
});

describe('resolving a declaration against release data', () => {
  const releases = [
    cycle('1.25'),
    cycle('1.24'),
    cycle('1.23', { isEol: true, eolFrom: '2026-02-11' }),
    cycle('1.22', { isEol: true, eolFrom: '2025-08-12' })
  ];

  it('reports a declaration on the newest supported cycle as current', () => {
    const resolved = resolveStack(declared('1.25'), releases, NOW);
    expect(resolved).toMatchObject({
      status: 'current',
      matchedCycle: '1.25',
      cyclesBehind: 0,
      latestCycle: '1.25',
      latestRelease: '1.25.9',
      baselineFetchedAt: FETCHED
    });
  });

  it('counts only supported cycles when measuring how far behind a declaration is', () => {
    // 1.23 and 1.22 are EOL, so a project on 1.24 is one cycle behind, not three.
    expect(resolveStack(declared('1.24'), releases, NOW)).toMatchObject({
      status: 'behind',
      cyclesBehind: 1
    });
  });

  it('matches the longest cycle prefix so patch versions land in their own cycle', () => {
    expect(resolveStack(declared('1.24.3'), releases, NOW)).toMatchObject({
      matchedCycle: '1.24',
      cycleLatestRelease: '1.24.9'
    });
  });

  it('marks a retired cycle as eol regardless of how far behind it is', () => {
    expect(resolveStack(declared('1.22'), releases, NOW)).toMatchObject({
      status: 'eol',
      eolFrom: '2025-08-12',
      cyclesBehind: 2
    });
  });

  it('treats a passed eolFrom as retired even when the cached flag predates it', () => {
    const stale = [cycle('1.25'), cycle('1.24', { isEol: false, eolFrom: '2026-07-29' })];
    expect(resolveStack(declared('1.24'), stale, NOW).status).toBe('eol');
    expect(resolveStack(declared('1.24'), stale, Date.parse('2026-07-28T00:00:00Z')).status).toBe(
      'behind'
    );
  });

  it('infers eol for a version below every cycle upstream still lists', () => {
    expect(resolveStack(declared('1.16'), releases, NOW)).toMatchObject({
      status: 'eol',
      matchedCycle: null,
      eolFrom: '2025-08-12'
    });
  });

  it('floats a declaration less specific than any cycle to the newest release in its line', () => {
    // `FROM golang:1-alpine` means "latest Go 1.x", not "Go 1.0", and must never read as retired.
    expect(resolveStack(declared('1'), releases, NOW)).toMatchObject({
      status: 'current',
      matchedCycle: '1.25',
      cyclesBehind: 0
    });
    // When the whole line is retired the declaration is genuinely end-of-life.
    const retired = [cycle('2'), cycle('1.9', { isEol: true, eolFrom: '2020-01-01' })];
    expect(resolveStack(declared('1'), retired, NOW)).toMatchObject({ status: 'eol' });
  });

  it('stays unknown for a version newer than anything upstream lists', () => {
    expect(resolveStack(declared('1.99'), releases, NOW)).toMatchObject({
      status: 'unknown',
      cyclesBehind: null,
      latestCycle: '1.25'
    });
  });

  it('stays unknown without release data or a parseable version', () => {
    expect(resolveStack(declared('1.24'), [], NOW).status).toBe('unknown');
    expect(resolveStack(declared('', 'stable'), releases, NOW).status).toBe('unknown');
  });

  it('takes the largest lag across a project for sorting, ignoring unknowns', () => {
    expect(
      stackLag([
        resolveStack(declared('1.24'), releases, NOW),
        resolveStack(declared('1.22'), releases, NOW),
        resolveStack(declared('', 'stable'), releases, NOW)
      ])
    ).toBe(2);
    expect(stackLag([resolveStack(declared('', 'stable'), releases, NOW)])).toBeNull();
    expect(stackLag([])).toBeNull();
  });
});
