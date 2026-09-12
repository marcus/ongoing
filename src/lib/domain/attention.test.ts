import { describe, expect, it } from 'vitest';
import type { ProjectMetrics } from './metrics';
import type { ResolvedStack } from './stack';
import { ATTENTION_THRESHOLDS, classifyAttentionViews, type AttentionInput } from './attention';
import type { UsedTechnology } from './technology';

const NOW = Date.parse('2026-07-19T12:00:00Z');
const fresh = '2026-07-19T11:00:00Z';

function input(
  partial: Partial<ProjectMetrics> = {},
  overrides: Partial<AttentionInput> = {}
): AttentionInput {
  return {
    id: 'project',
    isMissing: false,
    intent: null,
    stacks: [],
    errors: [],
    githubStarsGained30d: null,
    githubTrafficViewsDelta30d: null,
    githubTrafficClonesDelta30d: null,
    metrics: {
      projectId: 'project',
      gitScannedAt: fresh,
      locScannedAt: fresh,
      tdScannedAt: fresh,
      stackScannedAt: fresh,
      githubScannedAt: fresh,
      githubTrafficScannedAt: fresh,
      githubAvailability: 'available',
      githubTrafficAvailability: 'available',
      ...partial
    } as ProjectMetrics,
    ...overrides
  };
}

describe('transparent attention views', () => {
  it('returns inspectable reasons and treats thresholds as inclusive', () => {
    const attention = classifyAttentionViews(input({ tdBlockedCount: 1 }), NOW).attention;
    expect(attention).toMatchObject({ member: true });
    expect(attention.reasons[0]).toMatchObject({ input: 'tdBlockedCount', value: 1, threshold: 0 });

    expect(
      classifyAttentionViews(
        input({}, { githubStarsGained30d: ATTENTION_THRESHOLDS.risingStars30d }),
        NOW
      ).rising.member
    ).toBe(true);
    expect(
      classifyAttentionViews(input({ commits30d: 5, githubStars: 100 }), NOW).opportunity.member
    ).toBe(true);
    expect(
      classifyAttentionViews(input({ locCode: 5_000, tdTotalNonClosedCount: 5 }), NOW).quickwin
        .member
    ).toBe(true);
    expect(classifyAttentionViews(input({ commits30d: 10 }), NOW).momentum.member).toBe(true);
  });

  it('uses exact time windows for old PRs, releases, and dormant projects', () => {
    const boundary = new Date(NOW - 30 * 86_400_000).toISOString();
    expect(
      classifyAttentionViews(input({ githubOldestExternalPrAt: boundary }), NOW).attention.member
    ).toBe(true);
    expect(
      classifyAttentionViews(input({ githubLatestReleaseAt: boundary }), NOW).momentum.member
    ).toBe(true);

    const dormant = classifyAttentionViews(
      input(
        {
          commits30d: 0,
          latestCommitAt: new Date(NOW - 90 * 86_400_000).toISOString(),
          githubExternalPrs: 0,
          githubExternalIssues30d: 0
        },
        { githubStarsGained30d: 0 }
      ),
      NOW
    ).dormant;
    expect(dormant.member).toBe(true);
    expect(dormant.reasons.map(({ input }) => input)).toEqual([
      'latestCommitAgeDays',
      'knownDemandSignals',
      'intent'
    ]);
  });

  it('does not turn null, stale, or unavailable provider inputs into claims', () => {
    const empty = classifyAttentionViews(input({}, { metrics: null }), NOW);
    expect(Object.values(empty).every(({ member }) => !member)).toBe(true);

    const staleAt = new Date(
      NOW - (ATTENTION_THRESHOLDS.freshnessHours.github + 1) * 3_600_000
    ).toISOString();
    const stale = classifyAttentionViews(
      input(
        { githubScannedAt: staleAt, githubCiState: 'failure', githubStars: 5_000 },
        { githubStarsGained30d: 500 }
      ),
      NOW
    );
    expect(stale.attention.member).toBe(false);
    expect(stale.rising.member).toBe(false);
    expect(stale.opportunity.member).toBe(false);

    const unavailable = classifyAttentionViews(
      input({ githubAvailability: 'rate_limited', githubCiState: 'failure' }),
      NOW
    );
    expect(unavailable.attention.member).toBe(false);
  });

  it('rejects invalid and future collection times across every metric source', () => {
    const future = new Date(NOW + 1).toISOString();
    const invalid = 'not-a-timestamp';

    expect(
      classifyAttentionViews(input({ gitScannedAt: future, commits30d: 10 }), NOW).momentum.member
    ).toBe(false);
    expect(
      classifyAttentionViews(
        input({ locScannedAt: future, locCode: 100, tdTotalNonClosedCount: 1 }),
        NOW
      ).quickwin.member
    ).toBe(false);
    expect(
      classifyAttentionViews(input({ tdScannedAt: future, tdBlockedCount: 1 }), NOW).attention
        .member
    ).toBe(false);
    const futureGithub = classifyAttentionViews(
      input({ githubScannedAt: future, githubCiState: 'failure' }, { githubStarsGained30d: 100 }),
      NOW
    );
    expect(futureGithub.attention.member).toBe(false);
    expect(futureGithub.rising.member).toBe(false);
    expect(
      classifyAttentionViews(
        input(
          { githubTrafficScannedAt: future },
          { githubTrafficViewsDelta30d: 100, githubTrafficClonesDelta30d: 100 }
        ),
        NOW
      ).rising.member
    ).toBe(false);
    expect(
      classifyAttentionViews(input({ githubScannedAt: invalid, githubCiState: 'failure' }), NOW)
        .attention.member
    ).toBe(false);

    // Exact equality is the only accepted zero-age boundary; one millisecond of future skew is not.
    expect(
      classifyAttentionViews(
        input({ githubScannedAt: new Date(NOW).toISOString(), githubCiState: 'failure' }),
        NOW
      ).attention.member
    ).toBe(true);
  });

  it('requires known low demand and respects invest intent for dormant membership', () => {
    const base = input(
      { commits30d: 0, latestCommitAt: '2026-01-01T00:00:00Z' },
      { githubStarsGained30d: null }
    );
    expect(classifyAttentionViews(base, NOW).dormant.member).toBe(false);
    expect(
      classifyAttentionViews({ ...base, githubStarsGained30d: 0, intent: 'invest' }, NOW).dormant
        .member
    ).toBe(false);
  });
});

describe('the upgrade view', () => {
  const baselineFresh = '2026-07-18T00:00:00Z';

  function stack(overrides: Partial<ResolvedStack> = {}): ResolvedStack {
    return {
      toolchain: 'go',
      declared: '1.22',
      raw: '1.22',
      sourceFile: 'go.mod',
      status: 'behind',
      matchedCycle: '1.22',
      cycleLatestRelease: '1.22.9',
      latestCycle: '1.25',
      latestRelease: '1.25.12',
      cyclesBehind: ATTENTION_THRESHOLDS.upgradeCyclesBehind,
      eolFrom: null,
      baselineFetchedAt: baselineFresh,
      ...overrides
    };
  }

  const classify = (stacks: ResolvedStack[], metrics: Partial<ProjectMetrics> = {}) =>
    classifyAttentionViews(input(metrics, { stacks }), NOW).upgrade;

  it('flags a toolchain at or past the supported-releases-behind threshold', () => {
    const flagged = classify([stack()]);
    expect(flagged.member).toBe(true);
    expect(flagged.reasons[0]).toMatchObject({
      source: 'stack',
      input: 'stack.go.cyclesBehind',
      value: ATTENTION_THRESHOLDS.upgradeCyclesBehind,
      comparison: '>=',
      threshold: ATTENTION_THRESHOLDS.upgradeCyclesBehind
    });
    expect(flagged.reasons[0].message).toContain('2 supported releases behind 1.25');

    expect(
      classify([stack({ cyclesBehind: ATTENTION_THRESHOLDS.upgradeCyclesBehind - 1 })]).member
    ).toBe(false);
  });

  it('flags an end-of-life toolchain regardless of how far behind it is', () => {
    const flagged = classify([stack({ status: 'eol', cyclesBehind: 1, eolFrom: '2025-08-12' })]);
    expect(flagged.reasons[0]).toMatchObject({
      input: 'stack.go.eolFrom',
      value: '2025-08-12',
      comparison: '<=',
      threshold: '2026-07-19'
    });

    // A version older than anything upstream lists has no eol date to cite, but is still retired.
    expect(
      classify([stack({ status: 'eol', matchedCycle: null, cyclesBehind: 3 })]).reasons[0]
    ).toMatchObject({ input: 'stack.go.status', value: 'eol' });
  });

  it('never fires on unknown, current, stale, or unbacked declarations', () => {
    expect(classify([stack({ status: 'unknown', cyclesBehind: null })]).member).toBe(false);
    expect(classify([stack({ status: 'current', cyclesBehind: 0 })]).member).toBe(false);
    // Stack data itself must be fresh.
    expect(classify([stack()], { stackScannedAt: '2026-07-15T00:00:00Z' }).member).toBe(false);
    expect(classify([stack()], { stackScannedAt: null }).member).toBe(false);
    // So must the release baseline the claim rests on.
    const staleBaseline = new Date(
      NOW - (ATTENTION_THRESHOLDS.releaseBaselineMaxAgeDays + 1) * 86_400_000
    ).toISOString();
    expect(classify([stack({ baselineFetchedAt: staleBaseline })]).member).toBe(false);
    expect(classify([stack({ baselineFetchedAt: null })]).member).toBe(false);
  });

  it('reports one reason per toolchain even when several manifests declare it', () => {
    const flagged = classify([
      stack(),
      stack({ sourceFile: '.tool-versions' }),
      stack({ toolchain: 'node', declared: '20', latestCycle: '24' })
    ]);
    expect(flagged.reasons.map(({ input: key }) => key)).toEqual([
      'stack.go.cyclesBehind',
      'stack.node.cyclesBehind'
    ]);
  });
});

describe('the radar rules', () => {
  const technology = (overrides: Partial<UsedTechnology> = {}): UsedTechnology => ({
    slug: 'jquery',
    name: 'jQuery',
    ring: 'out',
    reviewAfter: null,
    version: '3.7.1',
    evidence: 'detected',
    sourceFile: 'package.json',
    ...overrides
  });

  const classify = (technologies: UsedTechnology[]) =>
    classifyAttentionViews(input({}, { technologies }), NOW);

  it('puts an out technology in the upgrade view with its version', () => {
    const upgrade = classify([technology()]).upgrade;
    expect(upgrade.member).toBe(true);
    expect(upgrade.reasons[0]).toMatchObject({
      source: 'tech',
      input: 'tech.jquery.ring',
      value: 'out',
      comparison: '=',
      threshold: 'out'
    });
    expect(upgrade.reasons[0].message).toContain('jQuery 3.7.1');
  });

  it('asks for attention once a ring is past its review date', () => {
    const stale = classify([technology({ ring: 'hot', reviewAfter: '2026-07-18' })]).attention;
    expect(stale.reasons[0]).toMatchObject({
      source: 'tech',
      input: 'tech.jquery.reviewAfter',
      value: '2026-07-18',
      comparison: '<',
      threshold: '2026-07-19'
    });
    // The review date is inclusive: a ring due today is not yet stale.
    expect(
      classify([technology({ ring: 'hot', reviewAfter: '2026-07-19' })]).attention.member
    ).toBe(false);
  });

  it('stays silent for a catalog with no radar data', () => {
    expect(classifyAttentionViews(input(), NOW).upgrade.member).toBe(false);
    expect(classify([technology({ ring: 'hot' })]).upgrade.member).toBe(false);
    expect(classify([technology({ ring: null })]).attention.member).toBe(false);
  });

  it('reports one reason per technology, ordered by slug', () => {
    const flagged = classify([
      technology({ slug: 'zulu', name: 'Zulu' }),
      technology({ slug: 'alpha', name: 'Alpha' })
    ]).upgrade;
    expect(flagged.reasons.map(({ input: key }) => key)).toEqual([
      'tech.alpha.ring',
      'tech.zulu.ring'
    ]);
  });
});
