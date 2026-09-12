import type { HostAdapter } from './adapter';
import { ForegroundHost } from './foreground';
import { LaunchdHost } from './launchd';

export * from './adapter';
export { ForegroundHost } from './foreground';
export { findLaunchdLabels, LaunchdHost, parseLaunchdPrint } from './launchd';
export { repositoryRoot, serveInForeground, scanInForeground } from './run';

export const hostAdapterNames = ['launchd', 'foreground'] as const;

export type HostAdapterName = (typeof hostAdapterNames)[number];

/**
 * The host adapter this machine uses. `[host] adapter` in the configuration file chooses it and
 * `ONGOING_HOST_ADAPTER` overrides. `launchd` is the default on macOS, where user LaunchAgents are
 * how a service is supervised; everywhere else — and for any name this build does not know —
 * `foreground` is the answer, because a host that cannot be identified can still run the
 * application in a terminal.
 *
 * `label` names the launchd agents when they cannot be discovered from `~/Library/LaunchAgents`.
 */
export function createHostAdapter(
  name: string | undefined,
  options: { root?: string; label?: string } = {}
): HostAdapter {
  const labels = options.label ? { web: options.label, scan: `${options.label}.scan` } : undefined;
  switch ((name ?? defaultHostAdapterName()).trim()) {
    case 'foreground':
      return new ForegroundHost(options);
    case 'launchd':
      return new LaunchdHost({ ...options, ...(labels ? { labels } : {}) });
    default:
      return new ForegroundHost(options);
  }
}

/** What this machine supervises services with, absent configuration. */
export function defaultHostAdapterName(platform = process.platform): HostAdapterName {
  return platform === 'darwin' ? 'launchd' : 'foreground';
}
