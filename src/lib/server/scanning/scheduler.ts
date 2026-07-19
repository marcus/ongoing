import { ScanInProgressError, type Scanner } from './scanner';

export interface SchedulerTimers {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (timer: unknown) => void;
}

const systemTimers: SchedulerTimers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  setInterval: (callback, interval) => setInterval(callback, interval),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>)
};

export class ScanScheduler {
  private startupTimer: unknown;
  private intervalTimer: unknown;
  private started = false;

  constructor(
    private readonly scanner: Scanner,
    private readonly timers: SchedulerTimers = systemTimers,
    private readonly intervalMs = 5 * 60_000,
    private readonly startupDelayMs = 250
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.startupTimer = this.timers.setTimeout(() => void this.run('startup'), this.startupDelayMs);
    this.intervalTimer = this.timers.setInterval(() => void this.run('scheduled'), this.intervalMs);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.startupTimer !== undefined) this.timers.clearTimeout(this.startupTimer);
    if (this.intervalTimer !== undefined) this.timers.clearInterval(this.intervalTimer);
    this.startupTimer = undefined;
    this.intervalTimer = undefined;
  }

  private async run(reason: 'startup' | 'scheduled'): Promise<void> {
    if (!this.started) return;
    try {
      const handle = await this.scanner.start({ reason });
      await handle.completion;
    } catch (error) {
      if (!(error instanceof ScanInProgressError))
        console.error(`Unable to start ${reason} scan`, error);
    }
  }
}
