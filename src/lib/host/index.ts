import type { HostAdapter } from './adapter';
import { ForegroundHost } from './foreground';
import { LaunchdHost } from './launchd';

export * from './adapter';
export { ForegroundHost } from './foreground';
export { LaunchdHost, parseLaunchdPrint } from './launchd';
export { repositoryRoot, serveInForeground, scanInForeground } from './run';

export const hostAdapterNames = ['launchd', 'foreground'] as const;

export type HostAdapterName = (typeof hostAdapterNames)[number];

/**
 * The host adapter this machine uses. `[host] adapter` in the configuration file chooses it and
 * `ONGOING_HOST_ADAPTER` overrides; `launchd` stays the default because that is what aerie runs,
 * and anything else falls back to `foreground` rather than failing, since a host that cannot be
 * identified can still run the application in a terminal.
 */
export function createHostAdapter(
  name: string | undefined,
  options: { root?: string } = {}
): HostAdapter {
  switch ((name ?? 'launchd').trim()) {
    case 'foreground':
      return new ForegroundHost(options);
    case 'launchd':
      return new LaunchdHost(options);
    default:
      return new ForegroundHost(options);
  }
}
