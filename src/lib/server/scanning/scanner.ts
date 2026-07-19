import { randomUUID } from 'node:crypto';
import type { ScanReason, ScanRun } from '$lib/domain/metrics';
import type { Project } from '$lib/domain/project';
import type { IssueMetrics } from '$lib/domain/providers';
import type { AppConfig } from '$lib/server/config';
import {
  ScanLeaseLostError,
  type CatalogRepository,
  type ScanLeaseOwnership
} from '$lib/server/catalog/repository';
import { collectGitMetrics, type GitMetrics } from '$lib/server/collectors/git';
import { collectLocMetrics, type LocCollectionResult } from '$lib/server/collectors/loc';
import { collectTdMetrics } from '$lib/server/collectors/td';
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
    config: Pick<AppConfig, 'scanRoots' | 'maxScanDepth' | 'ignoreGlobs'>,
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
  collectHosting?: (
    repository: CatalogRepository,
    projects: readonly Project[],
    options: { force: boolean; signal: AbortSignal; lease: ScanLeaseOwnership }
  ) => Promise<{ updatedProjectIds: string[]; errorCount: number }>;
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
  private readonly collectHosting: ScannerDependencies['collectHosting'];

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
            ignoreGlobs: config.ignoreGlobs
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
    this.collectHosting = dependencies.collectHosting;
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
      return { runId, status: 'failed', ...counts };
    } finally {
      this.clearInterval(heartbeat);
    }
  }

  private async executeAcquired(
    runId: string,
    request: ScanRequest,
    lease: ScanLeaseOwnership,
    signal: AbortSignal
  ): Promise<ScanResult> {
    const counts = { discoveredCount: 0, updatedCount: 0, errorCount: 0 };
    const cancelled = (): ScanResult => {
      this.progress.publish({ runId, type: 'cancelled', at: this.now(), ...counts });
      return { runId, status: 'cancelled', ...counts };
    };
    try {
      let projects: Project[];
      if (request.projectId) {
        const project = this.repository.getProject(request.projectId);
        if (!project) throw new Error(`Unknown project ID: ${request.projectId}`);
        projects = project.isHidden ? [] : [project];
      } else {
        const discovery = await this.discover(this.repository, this.config, lease);
        counts.discoveredCount = discovery.projects.length;
        projects = discovery.enrichmentProjects;
        await this.repository.updateScanRunProgress(runId, counts, lease);
        this.progress.publish({
          runId,
          type: 'discovered',
          at: this.now(),
          discoveredCount: counts.discoveredCount
        });
      }

      const localLimit = createConcurrencyLimit(this.config.gitConcurrency);
      const clocLimit = createConcurrencyLimit(this.config.clocConcurrency);
      const policy = request.refresh ?? refreshPolicyByReason[request.reason];
      const updatedProjects = new Set<string>();
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

            try {
              if (signal.aborted) throw new ScanLeaseLostError(runId);
              const metrics = await this.collectGit(project.canonicalPath, { signal });
              await this.repository.updateMetrics(project.id, metrics, lease);
              await this.repository.resolveCollectionError(project.id, 'git', this.now(), lease);
              updated = true;
              this.progress.publish({
                runId,
                type: 'collector-completed',
                at: this.now(),
                projectId: project.id,
                collector: 'git'
              });
            } catch (error) {
              if (error instanceof ScanLeaseLostError || signal.aborted)
                throw new ScanLeaseLostError(runId);
              counts.errorCount += 1;
              const message = errorMessage(error);
              await this.repository.recordCollectionError(
                {
                  projectId: project.id,
                  collector: 'git',
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
                collector: 'git',
                message
              });
            }

            try {
              if (signal.aborted) throw new ScanLeaseLostError(runId);
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
              await this.repository.resolveCollectionError(project.id, 'issues', this.now(), lease);
              if (metrics) updated = true;
              this.progress.publish({
                runId,
                type: 'collector-completed',
                at: this.now(),
                projectId: project.id,
                collector: 'issues'
              });
            } catch (error) {
              if (error instanceof ScanLeaseLostError || signal.aborted)
                throw new ScanLeaseLostError(runId);
              counts.errorCount += 1;
              const message = errorMessage(error);
              await this.repository.recordCollectionError(
                {
                  projectId: project.id,
                  collector: 'issues',
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
                collector: 'issues',
                message
              });
            }

            if (policy !== 'cheap') {
              try {
                const previousFingerprint =
                  this.repository.getMetrics(project.id)?.locFingerprint ?? null;
                const result = await clocLimit(() =>
                  this.collectLoc(project.canonicalPath, {
                    previousFingerprint,
                    force: policy === 'full',
                    signal
                  })
                );
                if (result.status === 'collected') {
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
                  updated = true;
                }
                await this.repository.resolveCollectionError(project.id, 'loc', this.now(), lease);
                this.progress.publish({
                  runId,
                  type: 'collector-completed',
                  at: this.now(),
                  projectId: project.id,
                  collector: 'loc'
                });
              } catch (error) {
                if (error instanceof ScanLeaseLostError || signal.aborted)
                  throw new ScanLeaseLostError(runId);
                counts.errorCount += 1;
                const message = errorMessage(error);
                await this.repository.recordCollectionError(
                  {
                    projectId: project.id,
                    collector: 'loc',
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
                  collector: 'loc',
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

      if (this.collectHosting && projects.length > 0) {
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
        await this.repository.updateScanRunProgress(runId, counts, lease);
      }

      await this.repository.finishScanRun(runId, 'completed', counts, this.now(), lease);
      this.progress.publish({ runId, type: 'completed', at: this.now(), ...counts });
      return { runId, status: 'completed', ...counts };
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
      return { runId, status: 'failed', ...counts };
    }
  }
}
