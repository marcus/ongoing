/**
 * The host seam (ADR 0007).
 *
 * `serve`, `scan`, `restart`, `stop`, and `logs` are the five things Ongoing asks of the machine it
 * runs on. `launchd` is the first implementation and `foreground` the second; a systemd or docker
 * adapter is a new file rather than a change to the CLI.
 *
 * Nothing in this file imports `$lib` or SvelteKit: the CLI loads it directly under bare Bun.
 */
export const hostServices = ['web', 'scan'] as const;

export type HostService = (typeof hostServices)[number];

export interface HostServiceStatus {
  service: HostService;
  adapter: string;
  /** The name the host knows this service by — a launchd label, a pid file, nothing. */
  label: string | null;
  /** `running`, `stopped`, `not loaded`, `unmanaged`, or whatever the host reports. */
  state: string;
  running: boolean;
  pid: number | null;
  detail: string | null;
}

export interface HostActionResult {
  ok: boolean;
  message: string;
}

export interface HostLogTarget {
  /** Files to tail, newest last. Empty when this host does not keep its own logs. */
  files: string[];
  detail: string | null;
}

export interface ServeOptions {
  /** Where the catalog lives for this run. A fresh directory is a fresh install. */
  dataDir?: string;
  databasePath?: string;
  host?: string;
  port?: number;
  /** Extra environment for the served process. */
  env?: Record<string, string | undefined>;
  /** Build the adapter bundle first when it is missing. */
  build?: boolean;
}

export interface HostScanOptions {
  dataDir?: string;
  databasePath?: string;
  full?: boolean;
  cheap?: boolean;
  projectId?: string;
  env?: Record<string, string | undefined>;
}

export interface HostAdapter {
  readonly name: string;
  status(service: HostService): Promise<HostServiceStatus>;
  restart(service: HostService, options?: { build?: boolean }): Promise<HostActionResult>;
  stop(service: HostService): Promise<HostActionResult>;
  logs(service: HostService): HostLogTarget;
  /** Runs the application in the foreground and resolves with its exit code. */
  serve(options?: ServeOptions): Promise<number>;
  /** Runs one scan and resolves with its exit code. */
  scan(options?: HostScanOptions): Promise<number>;
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type HostCommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; stdio?: 'inherit' | 'pipe' }
) => CommandResult;
