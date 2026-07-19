import { describe, expect, it } from 'vitest';
import type { ProjectMetrics } from './metrics';
import { ATTENTION_THRESHOLDS, classifyAttentionViews, type AttentionInput } from './attention';

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
    errors: [],
    githubStarsGained30d: null,
    githubTrafficViewsDelta30d: null,
    githubTrafficClonesDelta30d: null,
    metrics: {
      projectId: 'project',
      gitScannedAt: fresh,
      locScannedAt: fresh,
      tdScannedAt: fresh,
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
