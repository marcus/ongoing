import { describe, expect, it, vi } from 'vitest';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import type { AppConfig } from '$lib/server/config';
import type { GitMetrics } from '$lib/server/collectors/git';
import { ScanProgressBus } from '$lib/server/scanning/progress';
import { ScanScheduler, type SchedulerTimers } from '$lib/server/scanning/scheduler';
import { ScanInProgressError, Scanner, type ScanRequest } from '$lib/server/scanning/scanner';
import { createScanEventResponse } from '$lib/server/scanning/sse';

const now = '2026-07-19T10:00:00.000Z';
const config: AppConfig = {
  host: '127.0.0.1',
  port: 4173,
  scanRoots: ['/code'],
  databasePath: ':memory:',
  maxScanDepth: 3,
  ignoreGlobs: [],
  gitConcurrency: 6,
  clocConcurrency: 2
};

const gitMetrics: GitMetrics = {
  headSha: 'a'.repeat(40),
  branch: 'main',
  latestCommitAt: now,
  latestCommitSubject: 'subject',
  latestCommitShortSha: 'aaaaaaa',
  commitCount: 1,
  commits7d: 1,
  commits30d: 1,
  commits90d: 1,
  activeDays30d: 1,
  activeDays90d: 1,
  churnAdded30d: 1,
  churnDeleted30d: 0,
  churnAdded90d: 1,
  churnDeleted90d: 0,
  contributorCount: 1,
  localAuthorCommitShare30d: 1,
  dirtyFiles: 0,
  aheadCount: 0,
  behindCount: 0,
  latestTag: null,
  commitsSinceLatestTag: null,
  gitScannedAt: now
};

async function fixture(projectCount = 1) {
  const database = new CatalogDatabase(':memory:');
  const repository = new CatalogRepository(database, () => now);
  const projects = [];
  for (let index = 0; index < projectCount; index += 1) {
    projects.push(
      await repository.upsertDiscovered({
        canonicalPath: `/code/project-${index}`,
        relativePath: `project-${index}`,
        name: `project-${index}`,
        scanRoot: '/code'
      })
    );
  }
  return { database, repository, projects };
}

function discovery(projects: Awaited<ReturnType<typeof fixture>>['projects']) {
  return async () => ({
    projects,
    enrichmentProjects: projects.filter(({ isHidden }) => !isHidden)
  });
}

describe('resilient scan orchestration', () => {
  it('commits successful collectors independently and preserves cached LOC on failure', async () => {
    const { repository, projects } = await fixture();
    await repository.updateMetrics(projects[0].id, {
      locCode: 99,
      locFingerprint: 'old',
      locScannedAt: '2026-07-18T10:00:00.000Z'
    });
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_partial',
      discover: discovery(projects),
      collectGit: async () => gitMetrics,
      collectLoc: async () => {
        throw new Error('broken cloc');
      }
    });

    const result = await scanner.scan({ reason: 'manual' });

    expect(result).toMatchObject({ status: 'completed', updatedCount: 1, errorCount: 1 });
    expect(repository.getMetrics(projects[0].id)).toMatchObject({
      headSha: 'a'.repeat(40),
      locCode: 99,
      locFingerprint: 'old',
      locScannedAt: '2026-07-18T10:00:00.000Z'
    });
    expect(repository.listCollectionErrors(projects[0].id, true)).toEqual([
      expect.objectContaining({ collector: 'loc', message: 'broken cloc' })
    ]);
    expect(repository.getScanRun('scan_partial')).toMatchObject({
      status: 'completed',
      updatedCount: 1,
      errorCount: 1
    });
  });

  it('holds one durable lock across scanner instances', async () => {
    const { repository, projects } = await fixture();
    let release!: () => void;
    const blocked = new Promise<GitMetrics>((resolve) => {
      release = () => resolve(gitMetrics);
    });
    let id = 0;
    const dependencies = {
      now: () => now,
      createRunId: () => `scan_lock_${++id}`,
      discover: discovery(projects),
      collectGit: () => blocked
    };
    const first = new Scanner(repository, config, dependencies);
    const second = new Scanner(repository, config, dependencies);
    const handle = await first.start({ reason: 'scheduled', refresh: 'cheap' });

    await expect(second.start({ reason: 'manual' })).rejects.toBeInstanceOf(ScanInProgressError);
    release();
    await expect(handle.completion).resolves.toMatchObject({ status: 'completed' });
  });

  it('transactionally recovers an unfinished pre-lease run after restart', async () => {
    const { repository, projects } = await fixture();
    await repository.createScanRun({
      id: 'scan_interrupted',
      reason: 'startup',
      status: 'running',
      startedAt: '2026-07-18T10:00:00.000Z',
      finishedAt: null,
      discoveredCount: 1,
      updatedCount: 0,
      errorCount: 0
    });
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_recovered',
      createLeaseOwner: () => 'lease_recovered',
      discover: discovery(projects),
      collectGit: async () => gitMetrics
    });

    const result = await scanner.scan({ reason: 'scheduled', refresh: 'cheap' });

    expect(result).toMatchObject({ runId: 'scan_recovered', status: 'completed' });
    expect(repository.getScanRun('scan_interrupted')).toMatchObject({
      status: 'cancelled',
      finishedAt: now
    });
    expect(repository.getActiveScanRun()).toBeNull();
  });

  it('expires an interrupted leased run while preserving a recent live lease', async () => {
    const { repository, projects } = await fixture();
    const interrupted: Parameters<CatalogRepository['createScanRun']>[0] = {
      id: 'scan_expired',
      reason: 'manual',
      status: 'running',
      startedAt: '2026-07-18T09:00:00.000Z',
      finishedAt: null,
      discoveredCount: 0,
      updatedCount: 0,
      errorCount: 0
    };
    await expect(
      repository.tryCreateScanRun(interrupted, {
        owner: 'lease_dead_process',
        heartbeatAt: '2026-07-18T09:00:00.000Z',
        staleBefore: '2026-07-18T08:58:00.000Z'
      })
    ).resolves.toBe(true);
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_after_expiry',
      createLeaseOwner: () => 'lease_new_process',
      discover: discovery(projects),
      collectGit: async () => gitMetrics
    });

    await expect(scanner.scan({ reason: 'startup', refresh: 'cheap' })).resolves.toMatchObject({
      status: 'completed'
    });
    expect(repository.getScanRun('scan_expired')?.status).toBe('cancelled');
  });

  it('renews a live lease so long scans are not mistaken for interrupted runs', async () => {
    const { repository, projects } = await fixture();
    let currentTime = '2026-07-19T10:00:00.000Z';
    let heartbeat: (() => void) | undefined;
    let release!: () => void;
    const blocked = new Promise<GitMetrics>((resolve) => {
      release = () => resolve(gitMetrics);
    });
    const first = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_long_running',
      createLeaseOwner: () => 'lease_long_running',
      setInterval: (callback) => {
        heartbeat = callback;
        return 1;
      },
      clearInterval: vi.fn(),
      discover: discovery(projects),
      collectGit: () => blocked
    });
    const handle = await first.start({ reason: 'scheduled', refresh: 'cheap' });
    currentTime = '2026-07-19T10:01:30.000Z';
    heartbeat?.();
    await vi.waitFor(() =>
      expect(
        repository.database
          .query<{ heartbeat_at: string }, []>(
            "SELECT heartbeat_at FROM scan_runs WHERE status = 'running'"
          )
          .get()?.heartbeat_at
      ).toBe(currentTime)
    );

    currentTime = '2026-07-19T10:03:00.000Z';
    const contender = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_contender',
      createLeaseOwner: () => 'lease_contender',
      discover: discovery(projects),
      collectGit: async () => gitMetrics
    });
    await expect(contender.start({ reason: 'manual' })).rejects.toBeInstanceOf(ScanInProgressError);

    release();
    await handle.completion;
  });

  it('fences a displaced scanner from overwriting takeover metrics when it resumes', async () => {
    const { repository, projects } = await fixture();
    let currentTime = '2026-07-19T10:00:00.000Z';
    let releaseFirst!: () => void;
    const firstMetrics = new Promise<GitMetrics>((resolve) => {
      releaseFirst = () => resolve({ ...gitMetrics, headSha: 'a'.repeat(40), branch: 'old' });
    });
    const progress = new ScanProgressBus();
    const firstCollect = vi.fn(() => firstMetrics);
    const first = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_owner_a',
      createLeaseOwner: () => 'owner_a',
      setInterval: () => 1,
      clearInterval: vi.fn(),
      progress,
      discover: discovery(projects),
      collectGit: firstCollect
    });
    const firstHandle = await first.start({ reason: 'scheduled', refresh: 'cheap' });
    await vi.waitFor(() => expect(firstCollect).toHaveBeenCalledOnce());
    const liveResponse = createScanEventResponse({
      runId: firstHandle.runId,
      lastEventId: 0,
      signal: new AbortController().signal,
      repository,
      progress
    });
    const liveEvents = liveResponse.text();

    currentTime = '2026-07-19T10:03:00.000Z';
    const replacementMetrics = { ...gitMetrics, headSha: 'b'.repeat(40), branch: 'replacement' };
    const replacement = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_owner_b',
      createLeaseOwner: () => 'owner_b',
      discover: discovery(projects),
      collectGit: async () => replacementMetrics
    });
    await expect(replacement.scan({ reason: 'manual', refresh: 'cheap' })).resolves.toMatchObject({
      status: 'completed'
    });

    releaseFirst();
    await expect(firstHandle.completion).resolves.toMatchObject({ status: 'cancelled' });
    await expect(liveEvents).resolves.toContain('event: cancelled');
    expect(repository.getMetrics(projects[0].id)).toMatchObject({
      headSha: 'b'.repeat(40),
      branch: 'replacement'
    });
    expect(repository.getScanRun('scan_owner_a')?.status).toBe('cancelled');
    expect(repository.getScanRun('scan_owner_b')?.status).toBe('completed');
    expect(repository.getActiveScanRun()).toBeNull();
    const firstEvents = progress.eventsAfter('scan_owner_a');
    expect(firstEvents.filter(({ type }) => type === 'collector-completed')).toEqual([]);
    expect(firstEvents.filter(({ type }) => type === 'cancelled')).toHaveLength(1);
    expect(progress.isTerminal('scan_owner_a')).toBe(true);

    const terminal = firstEvents.at(-1)!;
    const reconnect = createScanEventResponse({
      runId: firstHandle.runId,
      lastEventId: terminal.id,
      signal: new AbortController().signal,
      repository,
      progress
    });
    await expect(reconnect.text()).resolves.toContain('event: cancelled');

    progress.publish({ runId: firstHandle.runId, type: 'cancelled', at: currentTime });
    expect(
      progress.eventsAfter(firstHandle.runId).filter(({ type }) => type === 'cancelled')
    ).toHaveLength(1);
  });

  it('fences project reconciliation when a lease is lost during discovery', async () => {
    const { repository, projects } = await fixture();
    let currentTime = '2026-07-19T10:00:00.000Z';
    let releaseDiscovery!: () => void;
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const first = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_discovery_a',
      createLeaseOwner: () => 'discovery_owner_a',
      setInterval: () => 1,
      clearInterval: vi.fn(),
      discover: async (catalog, _config, lease) => {
        await discoveryGate;
        const late = await catalog.upsertDiscovered(
          {
            canonicalPath: '/code/late-project',
            relativePath: 'late-project',
            name: 'late-project',
            scanRoot: '/code'
          },
          lease
        );
        return { projects: [late], enrichmentProjects: [late] };
      },
      collectGit: async () => gitMetrics
    });
    const firstHandle = await first.start({ reason: 'startup', refresh: 'cheap' });

    currentTime = '2026-07-19T10:03:00.000Z';
    const replacement = new Scanner(repository, config, {
      now: () => currentTime,
      createRunId: () => 'scan_discovery_b',
      createLeaseOwner: () => 'discovery_owner_b',
      collectGit: async () => ({ ...gitMetrics, branch: 'replacement' })
    });
    await replacement.scan({
      reason: 'project',
      projectId: projects[0].id,
      refresh: 'cheap'
    });
    releaseDiscovery();

    await expect(firstHandle.completion).resolves.toMatchObject({ status: 'cancelled' });
    expect(repository.listProjects({ includeHidden: true }).map(({ name }) => name)).toEqual([
      'project-0'
    ]);
    expect(repository.getMetrics(projects[0].id)?.branch).toBe('replacement');
    expect(repository.getActiveScanRun()).toBeNull();
  });

  it('closes SSE from durable cancellation when in-memory progress was lost', async () => {
    const { repository } = await fixture();
    await repository.createScanRun({
      id: 'scan_cancelled_on_restart',
      reason: 'startup',
      status: 'running',
      startedAt: now,
      finishedAt: null,
      discoveredCount: 0,
      updatedCount: 0,
      errorCount: 0
    });
    await repository.finishScanRun(
      'scan_cancelled_on_restart',
      'cancelled',
      { discoveredCount: 1, updatedCount: 0, errorCount: 0 },
      now
    );
    const response = createScanEventResponse({
      runId: 'scan_cancelled_on_restart',
      lastEventId: 12,
      signal: new AbortController().signal,
      repository,
      progress: new ScanProgressBus()
    });

    const events = await response.text();
    expect(events).toContain('id: 13');
    expect(events).toContain('event: cancelled');
  });

  it('publishes replayable progress and a terminal event', async () => {
    const { repository, projects } = await fixture();
    const progress = new ScanProgressBus();
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_progress',
      progress,
      discover: discovery(projects),
      collectGit: async () => gitMetrics,
      collectLoc: async () => ({ status: 'unchanged', fingerprint: 'same' })
    });

    await scanner.scan({ reason: 'startup' });
    const events = progress.eventsAfter('scan_progress');
    expect(events.map(({ type }) => type)).toEqual([
      'started',
      'discovered',
      'project-started',
      'collector-completed',
      'collector-completed',
      'completed'
    ]);
    expect(progress.eventsAfter('scan_progress', events[2].id)[0].id).toBe(events[3].id);
    expect(progress.isTerminal('scan_progress')).toBe(true);
  });

  it('caps repository work at six and cloc work at two', async () => {
    const { repository, projects } = await fixture(10);
    let activeGit = 0;
    let maxGit = 0;
    let activeCloc = 0;
    let maxCloc = 0;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_concurrency',
      discover: discovery(projects),
      collectGit: async () => {
        activeGit += 1;
        maxGit = Math.max(maxGit, activeGit);
        await pause();
        activeGit -= 1;
        return gitMetrics;
      },
      collectLoc: async () => {
        activeCloc += 1;
        maxCloc = Math.max(maxCloc, activeCloc);
        await pause();
        activeCloc -= 1;
        return { status: 'unchanged', fingerprint: 'same' };
      }
    });

    await scanner.scan({ reason: 'manual' });
    expect(maxGit).toBe(6);
    expect(maxCloc).toBe(2);
  });

  it('skips hidden-project enrichment', async () => {
    const { repository, projects } = await fixture();
    await repository.setHidden(projects[0].id, true);
    const collectGit = vi.fn(async () => gitMetrics);
    const scanner = new Scanner(repository, config, {
      now: () => now,
      createRunId: () => 'scan_hidden',
      discover: discovery([{ ...projects[0], isHidden: true }]),
      collectGit
    });
    const result = await scanner.scan({ reason: 'scheduled' });
    expect(result.updatedCount).toBe(0);
    expect(collectGit).not.toHaveBeenCalled();
  });
});

describe('scan scheduling', () => {
  it('defers startup and schedules a five-minute cheap refresh without overlapping setup', async () => {
    let startup: (() => void) | undefined;
    let scheduled: (() => void) | undefined;
    const timers: SchedulerTimers = {
      setTimeout: (callback, delay) => {
        expect(delay).toBe(250);
        startup = callback;
        return 1;
      },
      clearTimeout: vi.fn(),
      setInterval: (callback, delay) => {
        expect(delay).toBe(300_000);
        scheduled = callback;
        return 2;
      },
      clearInterval: vi.fn()
    };
    const start = vi.fn(async (request: ScanRequest) => {
      void request;
      return {
        runId: 'run',
        completion: Promise.resolve({
          runId: 'run',
          status: 'completed' as const,
          discoveredCount: 0,
          updatedCount: 0,
          errorCount: 0
        })
      };
    });
    const scheduler = new ScanScheduler({ start } as unknown as Scanner, timers);

    scheduler.start();
    expect(start).not.toHaveBeenCalled();
    startup?.();
    scheduled?.();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls.map(([request]) => request)).toEqual([
      { reason: 'startup' },
      { reason: 'scheduled' }
    ]);
    scheduler.stop();
    expect(timers.clearTimeout).toHaveBeenCalledWith(1);
    expect(timers.clearInterval).toHaveBeenCalledWith(2);
  });
});
