import { randomUUID } from 'node:crypto';
import type { Collector, ScanReason, ScanRun } from '$lib/domain/metrics';
import type { Project } from '$lib/domain/project';
import { activeProviders, type ProviderAvailability } from '$lib/domain/provider';
import type { IssueMetrics } from '$lib/domain/providers';
import type { AppConfig } from '$lib/server/config';
import { resolveProviderStates } from '$lib/server/providers/registry';
import {
  ScanLeaseLostError,
  type CatalogRepository,
  type ProviderRunStatus,
  type ScanLeaseOwnership
} from '$lib/server/catalog/repository';
import { collectGitMetrics, type GitMetrics } from '$lib/server/collectors/git';
import { collectLocMetrics, type LocCollectionResult } from '$lib/server/collectors/loc';
import { collectTdMetrics } from '$lib/server/collectors/td';
import { collectStack, type StackCollection } from '$lib/server/collectors/stack';
import { discoverAndReconcile, type ReconciledDiscovery } from '$lib/server/collectors/discover';
import { createConcurrencyLimit } from './limit';
import { scanProgress, type ScanProgressBus } from './progress';

export type RefreshPolicy = 'cheap' | 'changed' | 'full';

export const refreshPolicyByReason: Readonly<Record<ScanReason, RefreshPolicy>> = {
  startup: 'changed',
  scheduled: 'cheap',
  manual: 'changed',
  project: 'changed',
  cli: 'changed'
};

export interface ScanRequest {
  reason: ScanReason;
  projectId?: string;
  refresh?: RefreshPolicy;
}

export interface ScanResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  discoveredCount: number;
  updatedCount: number;
  errorCount: number;
  /** Projects dropped because their directory is gone. Not persisted on the scan run. */
  forgottenCount: number;
}

export interface ScanHandle {
  runId: string;
  completion: Promise<ScanResult>;
}

export interface ScannerDependencies {
  now?: () => string;
  createRunId?: () => string;
  createLeaseOwner?: () => string;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  progress?: ScanProgressBus;
  discover?: (
    repository: CatalogRepository,
    config: Pick<
      AppConfig,
      | 'scanRoots'
      | 'maxScanDepth'
      | 'ignoreGlobs'
      | 'forgetMissingProjects'
      | 'forgetMissingAfterDays'
    >,
    lease: ScanLeaseOwnership
  ) => Promise<ReconciledDiscovery>;
  collectGit?: (repositoryPath: string, options: { signal: AbortSignal }) => Promise<GitMetrics>;
  collectLoc?: (
    repositoryPath: string,
    options: { previousFingerprint: string | null; force: boolean; signal: AbortSignal }
  ) => Promise<LocCollectionResult>;
  collectIssues?: (
    repositoryPath: string,
    options: { signal: AbortSignal }
  ) => Promise<IssueMetrics | null>;
  collectStack?: (
    repositoryPath: string,
    options: { signal: AbortSignal }
  ) => Promise<StackCollection>;
  refreshReleaseBaselines?: (
    repository: CatalogRepository,
    options: { force: boolean; signal: AbortSignal; lease: ScanLeaseOwnership }
  ) => Promise<void>;
  collectHosting?: (
    repository: CatalogRepository,
    projects: readonly Project[],
    options: { force: boolean; signal: AbortSignal; lease: ScanLeaseOwnership }
  ) => Promise<{ updatedProjectIds: string[]; errorCount: number }>;
  /**
   * Which providers this configuration and this machine allow to run. Injected so a test can put a
   * provider out of reach without changing the machine.
   */
  resolveProviders?: () => ProviderAvailability[];
}

/** What one provider did during a scan, accumulated as it runs and written out at the end. */
interface ProviderOutcome {
  ran: number;
  failed: number;
  detail: string | null;
}

export class ScanInProgressError extends Error {
  constructor(readonly runId: string | null) {
    super('A catalog scan is already running');
    this.name = 'ScanInProgressError';
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

export class Scanner {
  private readonly now: () => string;
  private readonly createRunId: () => string;
  private readonly createLeaseOwner: () => string;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly setInterval: (callback: () => void, intervalMs: number) => unknown;
  private readonly clearInterval: (timer: unknown) => void;
  private readonly progress: ScanProgressBus;
  private readonly discover: NonNullable<ScannerDependencies['discover']>;
  private readonly collectGit: NonNullable<ScannerDependencies['collectGit']>;
  private readonly collectLoc: NonNullable<ScannerDependencies['collectLoc']>;
  private readonly collectIssues: NonNullable<ScannerDependencies['collectIssues']>;
  private readonly collectStack: NonNullable<ScannerDependencies['collectStack']>;
  private readonly refreshReleaseBaselines: ScannerDependencies['refreshReleaseBaselines'];
  private readonly collectHosting: ScannerDependencies['collectHosting'];
  private readonly resolveProviders: NonNullable<ScannerDependencies['resolveProviders']>;

  constructor(
    private readonly repository: CatalogRepository,
    private readonly config: AppConfig,
    dependencies: ScannerDependencies = {}
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createRunId = dependencies.createRunId ?? (() => `scan_${randomUUID()}`);
    this.createLeaseOwner =
      dependencies.createLeaseOwner ?? (() => `lease_${process.pid}_${randomUUID()}`);
    this.leaseDurationMs = dependencies.leaseDurationMs ?? 120_000;
    this.heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? 10_000;
    if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs <= 0)
      throw new RangeError('Scan lease duration must be positive');
    if (!Number.isFinite(this.heartbeatIntervalMs) || this.heartbeatIntervalMs <= 0)
      throw new RangeError('Scan heartbeat interval must be positive');
    if (this.heartbeatIntervalMs >= this.leaseDurationMs)
      throw new RangeError('Scan heartbeat interval must be shorter than the lease duration');
    this.setInterval =
      dependencies.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clearInterval =
      dependencies.clearInterval ??
      ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
    this.progress = dependencies.progress ?? scanProgress;
    this.discover =
      dependencies.discover ??
      ((repository, config, lease) =>
        discoverAndReconcile(
          repository,
          {
            scanRoots: config.scanRoots,
            maxDepth: config.maxScanDepth,
            ignoreGlobs: config.ignoreGlobs,
            forgetMissing: config.forgetMissingProjects,
            forgetMissingAfterMs: config.forgetMissingAfterDays * 86_400_000
          },
          lease
        ));
    this.collectGit =
      dependencies.collectGit ??
      ((path, options) => collectGitMetrics(path, { now: this.now, signal: options.signal }));
    this.collectLoc =
      dependencies.collectLoc ??
      ((path, options) =>
        collectLocMetrics(path, {
          previousFingerprint: options.previousFingerprint,
          force: options.force,
          now: this.now,
          signal: options.signal
        }));
    this.collectIssues =
      dependencies.collectIssues ??
      ((path, options) =>
        collectTdMetrics(path, { now: () => new Date(this.now()), signal: options.signal }));
    this.collectStack =
      dependencies.collectStack ??
      ((path, options) => collectStack(path, { signal: options.signal }));
    this.refreshReleaseBaselines = dependencies.refreshReleaseBaselines;
    this.collectHosting = dependencies.collectHosting;
    this.resolveProviders =
      dependencies.resolveProviders ?? (() => resolveProviderStates(this.config));
  }

  async start(request: ScanRequest): Promise<ScanHandle> {
    if (request.projectId && request.reason !== 'project')
      throw new Error('Per-project scans must use the project reason');
    if (!request.projectId && request.reason === 'project')
      throw new Error('Project scans require a project ID');
    if (request.projectId && !this.repository.getProject(request.projectId))
      throw new Error(`Unknown project ID: ${request.projectId}`);

    const runId = this.createRunId();
    const startedAt = this.now();
    const startedAtDate = new Date(startedAt);
    if (Number.isNaN(startedAtDate.valueOf()))
      throw new Error('Scanner clock returned an invalid time');
    const leaseOwner = this.createLeaseOwner();
    const run: ScanRun = {
      id: runId,
      reason: request.reason,
      status: 'running',
      startedAt,
      finishedAt: null,
      discoveredCount: 0,
      updatedCount: 0,
      errorCount: 0
    };
    if (
      !(await this.repository.tryCreateScanRun(run, {
        owner: leaseOwner,
        heartbeatAt: startedAt,
        staleBefore: new Date(startedAtDate.valueOf() - this.leaseDurationMs).toISOString()
      }))
    )
      throw new ScanInProgressError(this.repository.getActiveScanRun()?.id ?? null);

    this.progress.publish({ runId, type: 'started', at: startedAt });
    return { runId, completion: this.execute(runId, request, leaseOwner) };
  }

  async scan(request: ScanRequest): Promise<ScanResult> {
    return (await this.start(request)).completion;
  }

  private async execute(
    runId: string,
    request: ScanRequest,
    leaseOwner: string
  ): Promise<ScanResult> {
    const abortController = new AbortController();
    const heartbeat = this.setInterval(() => {
      void this.repository
        .renewScanLease(runId, leaseOwner, this.now())
        .then((renewed) => {
          if (!renewed) abortController.abort(new ScanLeaseLostError(runId));
        })
        .catch((error) => {
          console.error(`Unable to renew scan lease ${runId}`, error);
        });
    }, this.heartbeatIntervalMs);
    try {
      return await this.executeAcquired(
        runId,
        request,
        { runId, owner: leaseOwner },
        abortController.signal
      );
    } catch (error) {
      const counts = { discoveredCount: 0, updatedCount: 0, errorCount: 1 };
      this.progress.publish({
        runId,
        type: 'failed',
        at: this.now(),
        message: errorMessage(error),
        ...counts
      });
      return { runId, status: 'failed', ...counts, forgottenCount: 0 };
    } finally {
      this.clearInterval(heartbeat);
    }
  }

  /**
   * One scan, driven by the provider manifests.
   *
   * The sequence is no longer written down here: `resolveProviders` says which providers this
   * configuration and this machine allow, `activeProviders` puts them in dependency order, and each
   * step below declares which provider it belongs to. A disabled or unavailable provider contributes
   * nothing and records why; a provider that fails records a warning on the project and the scan
   * carries on (ADR 0002, ADR 0003).
   */
  private async executeAcquired(
    runId: string,
    request: ScanRequest,
    lease: ScanLeaseOwnership,
    signal: AbortSignal
  ): Promise<ScanResult> {
    const counts = { discoveredCount: 0, updatedCount: 0, errorCount: 0 };
    let forgottenCount = 0;
    const cancelled = (): ScanResult => {
      this.progress.publish({ runId, type: 'cancelled', at: this.now(), ...counts });
      return { runId, status: 'cancelled', ...counts, forgottenCount };
    };

    const states = this.resolveProviders();
    const active = new Set(activeProviders(states));
    this.repository.setActiveProviders([...active]);
    const outcomes = new Map<string, ProviderOutcome>(
      states.map(({ name }) => [name, { ran: 0, failed: 0, detail: null }])
    );
    const note = (provider: string, detail: string): void => {
      const outcome = outcomes.get(provider);
      if (outcome && !outcome.detail) outcome.detail = detail;
    };

    try {
      const policy = request.refresh ?? refreshPolicyByReason[request.reason];
      let projects: Project[];
      if (request.projectId) {
        const project = this.repository.getProject(request.projectId);
        if (!project) throw new Error(`Unknown project ID: ${request.projectId}`);
        projects = project.isHidden ? [] : [project];
        note('filesystem', 'single-project scan');
      } else if (active.has('filesystem')) {
        const discovery = await this.discover(this.repository, this.config, lease);
        counts.discoveredCount = discovery.projects.length;
        forgottenCount = discovery.forgotten.length;
        projects = discovery.enrichmentProjects;
        outcomes.get('filesystem')!.ran += 1;
        await this.repository.updateScanRunProgress(runId, counts, lease);
        this.progress.publish({
          runId,
          type: 'discovered',
          at: this.now(),
          discoveredCount: counts.discoveredCount
        });
      } else {
        // No discovery provider: enrich what the catalog already knows rather than doing nothing,
        // so turning discovery off is "stop finding new repositories", not "stop scanning".
        projects = this.repository.listProjects().filter((project) => !project.isMissing);
        counts.discoveredCount = projects.length;
        await this.repository.updateScanRunProgress(runId, counts, lease);
      }

      const localLimit = createConcurrencyLimit(this.config.gitConcurrency);
      const clocLimit = createConcurrencyLimit(this.config.clocConcurrency);
      const updatedProjects = new Set<string>();

      /**
       * The per-project providers, in the order `activeProviders` resolved. `collector` is the name
       * the warning rows and the progress stream have always used, and stays what it was so a
       * stored collection error keeps its meaning across this change.
       */
      const steps: {
        provider: string;
        collector: Extract<Collector, 'git' | 'loc' | 'issues' | 'stack'>;
        enabled: boolean;
        run: (project: Project) => Promise<boolean>;
      }[] = [
        {
          provider: 'git',
          collector: 'git',
          enabled: active.has('git'),
          run: async (project) => {
            const metrics = await this.collectGit(project.canonicalPath, { signal });
            await this.repository.updateMetrics(project.id, metrics, lease);
            return true;
          }
        },
        {
          provider: 'td',
          collector: 'issues',
          enabled: active.has('td'),
          run: async (project) => {
            const metrics = await this.collectIssues(project.canonicalPath, { signal });
            await this.repository.updateMetrics(
              project.id,
              metrics
                ? {
                    tdOpenCount: metrics.openCount,
                    tdInProgressCount: metrics.inProgressCount,
                    tdBlockedCount: metrics.blockedCount,
                    tdReviewCount: metrics.reviewCount,
                    tdTotalNonClosedCount: metrics.totalNonClosedCount,
                    tdStaleCount: metrics.staleCount,
                    tdScannedAt: this.now()
                  }
                : {
                    tdOpenCount: null,
                    tdInProgressCount: null,
                    tdBlockedCount: null,
                    tdReviewCount: null,
                    tdTotalNonClosedCount: null,
                    tdStaleCount: null,
                    tdScannedAt: null
                  },
              lease
            );
            return metrics !== null;
          }
        },
        {
          // Manifest reads are cheap enough to run on every policy, including the daily scheduled
          // scan. Gating them like `loc` would leave stack data permanently stale, which in turn
          // silently disables the Upgrade view's freshness gate.
          provider: 'stack',
          collector: 'stack',
          enabled: active.has('stack'),
          run: async (project) => {
            const collected = await this.collectStack(project.canonicalPath, { signal });
            await this.repository.replaceProjectStacks(project.id, collected.stacks, lease);
            // The tech-signatures provider owns these edges: they are rewritten whole on every scan,
            // so a dependency dropped from a manifest loses its edge here, while declared edges a
            // person wrote are left alone. With the provider off, the edges it wrote stay as they
            // were rather than being deleted by a scan that no longer looks for them.
            if (active.has('tech-signatures')) {
              await this.repository.replaceDetectedTechnologyUsage(
                project.id,
                collected.technologies,
                lease
              );
              outcomes.get('tech-signatures')!.ran += 1;
            }
            await this.repository.updateMetrics(project.id, { stackScannedAt: this.now() }, lease);
            return collected.stacks.length > 0;
          }
        },
        {
          provider: 'loc',
          collector: 'loc',
          enabled: active.has('loc') && policy !== 'cheap',
          run: async (project) => {
            const previousFingerprint =
              this.repository.getMetrics(project.id)?.locFingerprint ?? null;
            const result = await clocLimit(() =>
              this.collectLoc(project.canonicalPath, {
                previousFingerprint,
                force: policy === 'full',
                signal
              })
            );
            if (result.status !== 'collected') return false;
            await this.repository.updateMetrics(project.id, result.metrics, lease);
            await this.repository.saveSnapshot(
              {
                projectId: project.id,
                metric: 'loc_code',
                capturedOn: result.metrics.locScannedAt.slice(0, 10),
                value: result.metrics.locCode
              },
              lease
            );
            return true;
          }
        }
      ];

      if (active.has('loc') && policy === 'cheap')
        note('loc', 'skipped by the cheap refresh policy');

      await Promise.all(
        projects.map((project) =>
          localLimit(async () => {
            this.progress.publish({
              runId,
              type: 'project-started',
              at: this.now(),
              projectId: project.id
            });
            let updated = false;

            for (const step of steps) {
              if (!step.enabled) continue;
              try {
                if (signal.aborted) throw new ScanLeaseLostError(runId);
                if (await step.run(project)) updated = true;
                await this.repository.resolveCollectionError(
                  project.id,
                  step.collector,
                  this.now(),
                  lease
                );
                outcomes.get(step.provider)!.ran += 1;
                this.progress.publish({
                  runId,
                  type: 'collector-completed',
                  at: this.now(),
                  projectId: project.id,
                  collector: step.collector
                });
              } catch (error) {
                if (error instanceof ScanLeaseLostError || signal.aborted)
                  throw new ScanLeaseLostError(runId);
                counts.errorCount += 1;
                const message = errorMessage(error);
                const outcome = outcomes.get(step.provider)!;
                outcome.failed += 1;
                outcome.detail ??= message;
                await this.repository.recordCollectionError(
                  {
                    projectId: project.id,
                    collector: step.collector,
                    message,
                    occurredAt: this.now()
                  },
                  lease
                );
                this.progress.publish({
                  runId,
                  type: 'collector-failed',
                  at: this.now(),
                  projectId: project.id,
                  collector: step.collector,
                  message
                });
              }
            }

            if (updated) {
              updatedProjects.add(project.id);
              counts.updatedCount += 1;
            }
            await this.repository.updateScanRunProgress(runId, counts, lease);
          })
        )
      );

      // Runs after per-project collection so it only fetches toolchains projects actually declare.
      // A baseline failure is catalog-wide rather than any one project's fault, so it neither
      // records a collection error nor fails the run — cached cycles simply go stale.
      if (active.has('endoflife') && this.refreshReleaseBaselines && projects.length > 0) {
        if (signal.aborted) throw new ScanLeaseLostError(runId);
        try {
          await this.refreshReleaseBaselines(this.repository, {
            force: policy === 'full',
            signal,
            lease
          });
          outcomes.get('endoflife')!.ran += 1;
        } catch (error) {
          if (error instanceof ScanLeaseLostError || signal.aborted)
            throw new ScanLeaseLostError(runId);
          outcomes.get('endoflife')!.failed += 1;
          note('endoflife', errorMessage(error));
          console.error('Unable to refresh toolchain release baselines', error);
        }
      }

      if (active.has('github') && this.collectHosting && projects.length > 0) {
        if (signal.aborted) throw new ScanLeaseLostError(runId);
        const enrichment = await this.collectHosting(this.repository, projects, {
          force: policy === 'full',
          signal,
          lease
        });
        for (const id of enrichment.updatedProjectIds) {
          if (!updatedProjects.has(id)) counts.updatedCount += 1;
          updatedProjects.add(id);
        }
        counts.errorCount += enrichment.errorCount;
        const outcome = outcomes.get('github')!;
        outcome.ran += 1;
        outcome.failed += enrichment.errorCount;
        await this.repository.updateScanRunProgress(runId, counts, lease);
      }

      await this.recordProviderRuns(runId, states, outcomes);
      await this.repository.finishScanRun(runId, 'completed', counts, this.now(), lease);
      this.progress.publish({ runId, type: 'completed', at: this.now(), ...counts });
      return { runId, status: 'completed', ...counts, forgottenCount };
    } catch (error) {
      if (error instanceof ScanLeaseLostError || signal.aborted) return cancelled();
      counts.errorCount += 1;
      const message = errorMessage(error);
      try {
        await this.repository.finishScanRun(runId, 'failed', counts, this.now(), lease);
      } catch (finishError) {
        if (finishError instanceof ScanLeaseLostError) return cancelled();
        throw finishError;
      }
      this.progress.publish({ runId, type: 'failed', at: this.now(), message, ...counts });
      return { runId, status: 'failed', ...counts, forgottenCount };
    }
  }

  /** What each provider did, so `ongoing providers` can answer "when, and why not". */
  private async recordProviderRuns(
    runId: string,
    states: readonly ProviderAvailability[],
    outcomes: ReadonlyMap<string, ProviderOutcome>
  ): Promise<void> {
    const at = this.now();
    for (const state of states) {
      const outcome = outcomes.get(state.name) ?? { ran: 0, failed: 0, detail: null };
      const status: ProviderRunStatus =
        state.state !== 'active'
          ? state.state
          : outcome.ran > 0
            ? 'ok'
            : outcome.failed > 0
              ? 'failed'
              : 'skipped';
      try {
        await this.repository.recordProviderRun({
          provider: state.name,
          status,
          lastRunAt: at,
          runId,
          detail: state.reason ?? outcome.detail
        });
      } catch (error) {
        // Provider bookkeeping is never worth failing a scan over.
        console.error(`Unable to record the ${state.name} provider run`, error);
      }
    }
  }
}
