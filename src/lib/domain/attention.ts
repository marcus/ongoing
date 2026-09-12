import type { Completeness } from './completeness';
import type { CollectionError, ProjectMetrics } from './metrics';
import type { ProjectIntent } from './project';
import type { ResolvedStack } from './stack';
import { isRingStale, type UsedTechnology } from './technology';

export const attentionViewKeys = [
  'attention',
  'rising',
  'quickwin',
  'opportunity',
  'momentum',
  'dormant',
  'upgrade'
] as const;

export type AttentionViewKey = (typeof attentionViewKeys)[number];

/** Explicit product thresholds. These are deliberately independent rules, not score weights. */
export const ATTENTION_THRESHOLDS = {
  freshnessHours: { git: 72, loc: 72, td: 72, github: 72, traffic: 72, stack: 72 },
  releaseBaselineMaxAgeDays: 14,
  upgradeCyclesBehind: 2,
  oldExternalPrDays: 30,
  risingStars30d: 5,
  risingExternalIssues30d: 2,
  risingTrafficViews30d: 25,
  risingTrafficClones30d: 10,
  opportunityMaxCommits30d: 5,
  opportunityStars: 100,
  quickWinMaxLoc: 5_000,
  quickWinMaxBacklog: 5,
  momentumCommits30d: 10,
  momentumActiveDays30d: 5,
  recentReleaseDays: 30,
  dormantCommitAgeDays: 90
} as const;

export interface AttentionInput {
  id: string;
  isMissing: boolean;
  intent: ProjectIntent | null;
  metrics: ProjectMetrics | null;
  stacks: readonly ResolvedStack[];
  errors: readonly CollectionError[];
  /**
   * Technologies this project holds a `uses` edge to. Absent means "the radar has nothing to say",
   * which is how a catalog with no technologies in it stays silent rather than wrong.
   */
  technologies?: readonly UsedTechnology[];
  /**
   * How many of this kind's required fields carry a value. Absent means "the registry was not in
   * hand", which keeps the rule silent rather than claiming an entry is incomplete.
   */
  completeness?: Completeness | null;
  githubStarsGained30d: number | null;
  githubTrafficViewsDelta30d: number | null;
  githubTrafficClonesDelta30d: number | null;
}

export interface AttentionReason {
  source: 'catalog' | 'git' | 'td' | 'github' | 'traffic' | 'decision' | 'stack' | 'tech';
  message: string;
  input: string;
  value: string | number | boolean | null;
  comparison: string;
  threshold: string | number | boolean | null;
}

export interface AttentionClassification {
  key: AttentionViewKey;
  member: boolean;
  reasons: AttentionReason[];
}

export type AttentionClassifications = Record<AttentionViewKey, AttentionClassification>;

const DAY = 86_400_000;

function age(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  // Future timestamps are invalid evidence, not "just collected" data. Accept exactly `now`
  // so deterministic boundary checks remain useful without allowing clock-skewed claims.
  return Number.isFinite(parsed) && parsed <= now ? (now - parsed) / DAY : null;
}

function fresh(value: string | null | undefined, hours: number, now: number): boolean {
  const ageDays = age(value, now);
  return ageDays !== null && ageDays * 24 <= hours;
}

function reason(
  source: AttentionReason['source'],
  message: string,
  input: string,
  value: AttentionReason['value'],
  comparison: string,
  threshold: AttentionReason['threshold']
): AttentionReason {
  return { source, message, input, value, comparison, threshold };
}

function classification(
  key: AttentionViewKey,
  reasons: AttentionReason[]
): AttentionClassification {
  return { key, member: reasons.length > 0, reasons };
}

/**
 * Classify one project into seven inspectable views. Missing, invalid, unavailable, or stale
 * measurements never satisfy a metric rule. Each view is independent; there is no priority score.
 */
export function classifyAttentionViews(
  project: AttentionInput,
  now = Date.now()
): AttentionClassifications {
  const metrics = project.metrics;
  const gitFresh = fresh(metrics?.gitScannedAt, ATTENTION_THRESHOLDS.freshnessHours.git, now);
  const tdFresh = fresh(metrics?.tdScannedAt, ATTENTION_THRESHOLDS.freshnessHours.td, now);
  const githubFresh =
    metrics?.githubAvailability === 'available' &&
    fresh(metrics.githubScannedAt, ATTENTION_THRESHOLDS.freshnessHours.github, now);
  const trafficFresh =
    metrics?.githubTrafficAvailability === 'available' &&
    fresh(metrics.githubTrafficScannedAt, ATTENTION_THRESHOLDS.freshnessHours.traffic, now);
  const stackFresh = fresh(metrics?.stackScannedAt, ATTENTION_THRESHOLDS.freshnessHours.stack, now);

  const attention: AttentionReason[] = [];
  if (project.isMissing)
    attention.push(
      reason('catalog', 'Repository is missing from disk', 'isMissing', true, '=', true)
    );
  if (project.errors.length)
    attention.push(
      reason(
        'catalog',
        `${project.errors.length} collector ${project.errors.length === 1 ? 'warning needs' : 'warnings need'} inspection`,
        'unresolvedCollectorErrors',
        project.errors.length,
        '>',
        0
      )
    );
  if (githubFresh && metrics?.githubCiState === 'failure')
    attention.push(
      reason(
        'github',
        'Latest cached CI state is failing',
        'githubCiState',
        'failure',
        '=',
        'failure'
      )
    );
  if (tdFresh && (metrics?.tdBlockedCount ?? 0) > 0)
    attention.push(
      reason(
        'td',
        `${metrics!.tdBlockedCount} blocked TD item(s)`,
        'tdBlockedCount',
        metrics!.tdBlockedCount,
        '>',
        0
      )
    );
  if (tdFresh && (metrics?.tdStaleCount ?? 0) > 0)
    attention.push(
      reason(
        'td',
        `${metrics!.tdStaleCount} stale TD item(s)`,
        'tdStaleCount',
        metrics!.tdStaleCount,
        '>',
        0
      )
    );
  /**
   * An incomplete entry the owner has committed to. Completeness on its own is not a reason to
   * look at something — most of the catalog is deliberately sparse — but a project marked `invest`
   * with no decision recorded is a gap in the inventory the inventory can see. It is ungated: a
   * required field with no value is a catalog fact, not a measurement.
   */
  if (project.intent === 'invest' && project.completeness && project.completeness.complete < 100)
    attention.push(
      reason(
        'decision',
        `Marked invest, but ${project.completeness.missing.join(', ')} ${project.completeness.missing.length === 1 ? 'is' : 'are'} not filled in`,
        'complete',
        project.completeness.complete,
        '<',
        100
      )
    );

  const externalPrAge = githubFresh ? age(metrics?.githubOldestExternalPrAt, now) : null;
  if (externalPrAge !== null && externalPrAge >= ATTENTION_THRESHOLDS.oldExternalPrDays)
    attention.push(
      reason(
        'github',
        `Oldest external PR is ${Math.floor(externalPrAge)} days old`,
        'githubOldestExternalPrAgeDays',
        Math.floor(externalPrAge),
        '>=',
        ATTENTION_THRESHOLDS.oldExternalPrDays
      )
    );

  const rising: AttentionReason[] = [];
  if (
    githubFresh &&
    project.githubStarsGained30d !== null &&
    project.githubStarsGained30d >= ATTENTION_THRESHOLDS.risingStars30d
  )
    rising.push(
      reason(
        'github',
        `Gained ${project.githubStarsGained30d} stars in 30 days`,
        'githubStarsGained30d',
        project.githubStarsGained30d,
        '>=',
        ATTENTION_THRESHOLDS.risingStars30d
      )
    );
  if (
    githubFresh &&
    metrics?.githubExternalIssues30d !== null &&
    metrics?.githubExternalIssues30d !== undefined &&
    metrics.githubExternalIssues30d >= ATTENTION_THRESHOLDS.risingExternalIssues30d
  )
    rising.push(
      reason(
        'github',
        `${metrics.githubExternalIssues30d} external issues opened in 30 days`,
        'githubExternalIssues30d',
        metrics.githubExternalIssues30d,
        '>=',
        ATTENTION_THRESHOLDS.risingExternalIssues30d
      )
    );
  if (
    trafficFresh &&
    project.githubTrafficViewsDelta30d !== null &&
    project.githubTrafficViewsDelta30d >= ATTENTION_THRESHOLDS.risingTrafficViews30d
  )
    rising.push(
      reason(
        'traffic',
        `Traffic views increased by ${project.githubTrafficViewsDelta30d}`,
        'githubTrafficViewsDelta30d',
        project.githubTrafficViewsDelta30d,
        '>=',
        ATTENTION_THRESHOLDS.risingTrafficViews30d
      )
    );
  if (
    trafficFresh &&
    project.githubTrafficClonesDelta30d !== null &&
    project.githubTrafficClonesDelta30d >= ATTENTION_THRESHOLDS.risingTrafficClones30d
  )
    rising.push(
      reason(
        'traffic',
        `Traffic clones increased by ${project.githubTrafficClonesDelta30d}`,
        'githubTrafficClonesDelta30d',
        project.githubTrafficClonesDelta30d,
        '>=',
        ATTENTION_THRESHOLDS.risingTrafficClones30d
      )
    );

  const demandReasons: AttentionReason[] = [];
  if (githubFresh && (metrics?.githubStars ?? 0) >= ATTENTION_THRESHOLDS.opportunityStars)
    demandReasons.push(
      reason(
        'github',
        `${metrics!.githubStars} stars show established interest`,
        'githubStars',
        metrics!.githubStars,
        '>=',
        ATTENTION_THRESHOLDS.opportunityStars
      )
    );
  if (githubFresh && (metrics?.githubExternalPrs ?? 0) > 0)
    demandReasons.push(
      reason(
        'github',
        `${metrics!.githubExternalPrs} external PR(s) are open`,
        'githubExternalPrs',
        metrics!.githubExternalPrs,
        '>',
        0
      )
    );
  if (githubFresh && (metrics?.githubExternalIssues30d ?? 0) > 0)
    demandReasons.push(
      reason(
        'github',
        `${metrics!.githubExternalIssues30d} external issue(s) arrived in 30 days`,
        'githubExternalIssues30d',
        metrics!.githubExternalIssues30d,
        '>',
        0
      )
    );
  const opportunity: AttentionReason[] = [];
  if (
    gitFresh &&
    metrics?.commits30d !== null &&
    metrics?.commits30d !== undefined &&
    metrics.commits30d <= ATTENTION_THRESHOLDS.opportunityMaxCommits30d &&
    demandReasons.length
  ) {
    opportunity.push(
      reason(
        'git',
        `Only ${metrics.commits30d} commits in 30 days`,
        'commits30d',
        metrics.commits30d,
        '<=',
        ATTENTION_THRESHOLDS.opportunityMaxCommits30d
      ),
      ...demandReasons
    );
  }

  const quickwin: AttentionReason[] = [];
  const small =
    fresh(metrics?.locScannedAt, ATTENTION_THRESHOLDS.freshnessHours.loc, now) &&
    metrics?.locCode !== null &&
    metrics?.locCode !== undefined &&
    metrics.locCode <= ATTENTION_THRESHOLDS.quickWinMaxLoc;
  const smallBacklog =
    tdFresh &&
    metrics?.tdTotalNonClosedCount !== null &&
    metrics?.tdTotalNonClosedCount !== undefined &&
    metrics.tdTotalNonClosedCount > 0 &&
    metrics.tdTotalNonClosedCount <= ATTENTION_THRESHOLDS.quickWinMaxBacklog;
  const smallGithubBacklog =
    githubFresh &&
    metrics?.githubOpenIssues !== null &&
    metrics?.githubOpenIssues !== undefined &&
    metrics.githubOpenIssues > 0 &&
    metrics.githubOpenIssues <= ATTENTION_THRESHOLDS.quickWinMaxBacklog;
  if (small && (smallBacklog || smallGithubBacklog)) {
    quickwin.push(
      reason(
        'git',
        `${metrics!.locCode} lines of code keeps the project small`,
        'locCode',
        metrics!.locCode,
        '<=',
        ATTENTION_THRESHOLDS.quickWinMaxLoc
      )
    );
    if (smallBacklog)
      quickwin.push(
        reason(
          'td',
          `${metrics!.tdTotalNonClosedCount} TD items form a small backlog`,
          'tdTotalNonClosedCount',
          metrics!.tdTotalNonClosedCount,
          'between',
          `1–${ATTENTION_THRESHOLDS.quickWinMaxBacklog}`
        )
      );
    if (smallGithubBacklog)
      quickwin.push(
        reason(
          'github',
          `${metrics!.githubOpenIssues} GitHub issues form a small backlog`,
          'githubOpenIssues',
          metrics!.githubOpenIssues,
          'between',
          `1–${ATTENTION_THRESHOLDS.quickWinMaxBacklog}`
        )
      );
  }

  const momentum: AttentionReason[] = [];
  if (gitFresh && (metrics?.commits30d ?? -1) >= ATTENTION_THRESHOLDS.momentumCommits30d)
    momentum.push(
      reason(
        'git',
        `${metrics!.commits30d} commits in 30 days`,
        'commits30d',
        metrics!.commits30d,
        '>=',
        ATTENTION_THRESHOLDS.momentumCommits30d
      )
    );
  if (gitFresh && (metrics?.activeDays30d ?? -1) >= ATTENTION_THRESHOLDS.momentumActiveDays30d)
    momentum.push(
      reason(
        'git',
        `Active on ${metrics!.activeDays30d} days this month`,
        'activeDays30d',
        metrics!.activeDays30d,
        '>=',
        ATTENTION_THRESHOLDS.momentumActiveDays30d
      )
    );
  if (githubFresh && (metrics?.githubMergedPrs30d ?? 0) > 0)
    momentum.push(
      reason(
        'github',
        `${metrics!.githubMergedPrs30d} PR(s) merged in 30 days`,
        'githubMergedPrs30d',
        metrics!.githubMergedPrs30d,
        '>',
        0
      )
    );
  const releaseAge = githubFresh ? age(metrics?.githubLatestReleaseAt, now) : null;
  if (releaseAge !== null && releaseAge <= ATTENTION_THRESHOLDS.recentReleaseDays)
    momentum.push(
      reason(
        'github',
        `Released ${Math.floor(releaseAge)} days ago`,
        'githubLatestReleaseAgeDays',
        Math.floor(releaseAge),
        '<=',
        ATTENTION_THRESHOLDS.recentReleaseDays
      )
    );

  const dormant: AttentionReason[] = [];
  const latestCommitAge = gitFresh ? age(metrics?.latestCommitAt, now) : null;
  const demandKnownLow =
    githubFresh &&
    metrics?.githubExternalPrs === 0 &&
    metrics.githubExternalIssues30d === 0 &&
    project.githubStarsGained30d !== null &&
    project.githubStarsGained30d <= 0;
  if (
    gitFresh &&
    metrics?.commits30d === 0 &&
    latestCommitAge !== null &&
    latestCommitAge >= ATTENTION_THRESHOLDS.dormantCommitAgeDays &&
    demandKnownLow &&
    project.intent !== 'invest'
  ) {
    dormant.push(
      reason(
        'git',
        `No commits in 30 days; latest commit is ${Math.floor(latestCommitAge)} days old`,
        'latestCommitAgeDays',
        Math.floor(latestCommitAge),
        '>=',
        ATTENTION_THRESHOLDS.dormantCommitAgeDays
      ),
      reason(
        'github',
        'No current external PRs, recent external issues, or star growth',
        'knownDemandSignals',
        0,
        '=',
        0
      ),
      reason('decision', 'Project is not marked invest', 'intent', project.intent, '!=', 'invest')
    );
  }

  const upgrade: AttentionReason[] = [];
  const claimed = new Set<string>();
  const today = new Date(now).toISOString().slice(0, 10);
  if (stackFresh) {
    for (const stack of project.stacks) {
      // Release data this old cannot support a claim about what is current upstream.
      const baselineAge = age(stack.baselineFetchedAt, now);
      if (
        baselineAge === null ||
        baselineAge > ATTENTION_THRESHOLDS.releaseBaselineMaxAgeDays ||
        claimed.has(stack.toolchain)
      )
        continue;

      const declared = stack.declared || stack.raw;
      if (stack.status === 'eol') {
        claimed.add(stack.toolchain);
        upgrade.push(
          stack.eolFrom
            ? reason(
                'stack',
                `${stack.toolchain} ${declared} reached end of life on ${stack.eolFrom}`,
                `stack.${stack.toolchain}.eolFrom`,
                stack.eolFrom,
                '<=',
                today
              )
            : reason(
                'stack',
                `${stack.toolchain} ${declared} predates every release upstream still supports`,
                `stack.${stack.toolchain}.status`,
                'eol',
                '=',
                'eol'
              )
        );
      } else if (
        stack.cyclesBehind !== null &&
        stack.cyclesBehind >= ATTENTION_THRESHOLDS.upgradeCyclesBehind
      ) {
        claimed.add(stack.toolchain);
        upgrade.push(
          reason(
            'stack',
            `${stack.toolchain} ${declared} is ${stack.cyclesBehind} supported releases behind ${stack.latestCycle}`,
            `stack.${stack.toolchain}.cyclesBehind`,
            stack.cyclesBehind,
            '>=',
            ATTENTION_THRESHOLDS.upgradeCyclesBehind
          )
        );
      }
    }
  }

  /**
   * The radar's two reasons. A technology edge is a catalog fact rather than a measurement — a
   * declared edge was written by hand and a detected one is the last thing the manifests said — so
   * these are ungated, like `isMissing` and collector warnings, rather than sitting behind a
   * collector's freshness window. A ring that has been in `out` since before the last scan is still
   * a true statement about the project today.
   */
  for (const technology of [...(project.technologies ?? [])].sort((left, right) =>
    left.slug.localeCompare(right.slug, 'en')
  )) {
    const version = technology.version ? ` ${technology.version}` : '';
    if (technology.ring === 'out')
      upgrade.push(
        reason(
          'tech',
          `Uses ${technology.name}${version}, which is ring out`,
          `tech.${technology.slug}.ring`,
          'out',
          '=',
          'out'
        )
      );
    if (isRingStale(technology.reviewAfter, now))
      attention.push(
        reason(
          'tech',
          `${technology.name}’s ring was due for review on ${technology.reviewAfter}`,
          `tech.${technology.slug}.reviewAfter`,
          technology.reviewAfter,
          '<',
          today
        )
      );
  }

  return {
    attention: classification('attention', attention),
    rising: classification('rising', rising),
    quickwin: classification('quickwin', quickwin),
    opportunity: classification('opportunity', opportunity),
    momentum: classification('momentum', momentum),
    dormant: classification('dormant', dormant),
    upgrade: classification('upgrade', upgrade)
  };
}
