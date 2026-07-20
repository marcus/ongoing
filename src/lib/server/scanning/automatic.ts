import type { AppConfig } from '$lib/server/config';

interface Scheduler {
  start(): void;
}

export interface AutomaticScanState {
  scheduled: boolean;
}

export interface AutomaticScanDependencies {
  defer(callback: () => void): unknown;
  loadScheduler(): Promise<Scheduler>;
}

const defaults: AutomaticScanDependencies = {
  defer: (callback) => setTimeout(callback, 0),
  loadScheduler: () => import('./runtime').then(({ catalogScanScheduler }) => catalogScanScheduler)
};

/** Schedule development's startup/interval scanner without coupling hooks to timer details. */
export function scheduleAutomaticScan(
  config: Pick<AppConfig, 'automaticScanSchedulerEnabled'>,
  state: AutomaticScanState,
  isPublicRequest: boolean,
  dependencies: AutomaticScanDependencies = defaults
): void {
  if (!config.automaticScanSchedulerEnabled || state.scheduled || isPublicRequest) return;
  state.scheduled = true;
  dependencies.defer(() => {
    void dependencies.loadScheduler().then((scheduler) => scheduler.start());
  });
}
