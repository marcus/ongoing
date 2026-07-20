import { describe, expect, it, vi } from 'vitest';
import { scheduleAutomaticScan, type AutomaticScanState } from './automatic';

function setup(enabled: boolean) {
  const state: AutomaticScanState = { scheduled: false };
  const start = vi.fn();
  let deferred: (() => void) | undefined;
  const dependencies = {
    defer: vi.fn((callback: () => void) => {
      deferred = callback;
      return 1;
    }),
    loadScheduler: vi.fn(async () => ({ start }))
  };
  scheduleAutomaticScan({ automaticScanSchedulerEnabled: enabled }, state, false, dependencies);
  return { state, start, deferred, dependencies };
}

describe('automatic scan hook boundary', () => {
  it('creates no startup or interval scheduler when production disables it', () => {
    const { state, dependencies } = setup(false);
    expect(state.scheduled).toBe(false);
    expect(dependencies.defer).not.toHaveBeenCalled();
    expect(dependencies.loadScheduler).not.toHaveBeenCalled();
  });

  it('preserves deferred development startup and starts only once', async () => {
    const { state, start, deferred, dependencies } = setup(true);
    expect(state.scheduled).toBe(true);
    expect(start).not.toHaveBeenCalled();
    deferred?.();
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    scheduleAutomaticScan({ automaticScanSchedulerEnabled: true }, state, false, dependencies);
    expect(dependencies.defer).toHaveBeenCalledOnce();
  });
});
