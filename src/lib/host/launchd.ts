import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  HostActionResult,
  HostAdapter,
  HostCommandRunner,
  HostLogTarget,
  HostScanOptions,
  HostService,
  HostServiceStatus,
  ServeOptions
} from './adapter';
import {
  commandFailed,
  repositoryRoot,
  scanInForeground,
  serveInForeground,
  systemRunner,
  userId
} from './run';

/**
 * The launchd host: two user LaunchAgents, one serving and one scanning on a calendar.
 *
 * Everything that reads launchd's output goes through {@link parseLaunchdPrint}, which is a pure
 * function over the text `launchctl print` produces, so the adapter is tested against captured
 * output rather than against the machine's real agents.
 *
 * The labels are **discovered, not written down here**. Whoever installed the agents chose a
 * reverse-DNS prefix of their own, and that choice belongs to the deployment profile rather than to
 * the application, so the adapter looks in `~/Library/LaunchAgents` for the definitions that serve
 * and scan Ongoing and uses whatever they are called. `[host] label` or `ONGOING_LAUNCHD_LABEL`
 * names them outright; the fallback is only what an install that has written nothing would be.
 */
export const DEFAULT_LAUNCHD_WEB_LABEL = 'ongoing';
export const DEFAULT_LAUNCHD_SCAN_LABEL = `${DEFAULT_LAUNCHD_WEB_LABEL}.scan`;

/** The web agent is `<anything>ongoing.plist`; the scan agent is `<anything>ongoing.scan.plist`. */
export function findLaunchdLabels(
  fileNames: readonly string[],
  fallback: Record<HostService, string> = {
    web: DEFAULT_LAUNCHD_WEB_LABEL,
    scan: DEFAULT_LAUNCHD_SCAN_LABEL
  }
): Record<HostService, string> {
  const labels = [...fileNames]
    .filter((name) => name.endsWith('.plist'))
    .map((name) => name.slice(0, -'.plist'.length))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const scan = labels.find((label) => /(^|\.)ongoing\.scan$/i.test(label));
  const web = labels.find((label) => /(^|\.)ongoing$/i.test(label));
  return {
    web: web ?? (scan ? scan.slice(0, -'.scan'.length) : fallback.web),
    scan: scan ?? `${web ?? fallback.web}.scan`
  };
}

export interface LaunchdPrintState {
  state: string;
  running: boolean;
  pid: number | null;
  lastExitStatus: number | null;
}

/** `launchctl print gui/501/<label>` output, reduced to what a status line needs. */
export function parseLaunchdPrint(output: string): LaunchdPrintState {
  const state = /^\s*state = (.+)$/m.exec(output)?.[1]?.trim() ?? 'unknown';
  const pid = Number(/^\s*pid = (\d+)$/m.exec(output)?.[1] ?? NaN);
  const exit = Number(/^\s*last exit code = (-?\d+)$/m.exec(output)?.[1] ?? NaN);
  return {
    state,
    running: state === 'running',
    pid: Number.isFinite(pid) ? pid : null,
    lastExitStatus: Number.isFinite(exit) ? exit : null
  };
}

export interface LaunchdOptions {
  runner?: HostCommandRunner;
  uid?: number;
  home?: string;
  root?: string;
  labels?: Record<HostService, string>;
  logDirectory?: string;
  /** Injected so a test can wait instantly instead of really sleeping between bootstrap attempts. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The agent definitions this user has installed. An unreadable directory means "none". */
function readAgentDirectory(home: string): string[] {
  try {
    return readdirSync(join(home, 'Library/LaunchAgents'));
  } catch {
    return [];
  }
}

export class LaunchdHost implements HostAdapter {
  readonly name = 'launchd';
  private readonly runner: HostCommandRunner;
  private readonly uid: number;
  private readonly home: string;
  private readonly root: string;
  private readonly labels: Record<HostService, string>;
  private readonly logDirectory: string;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(options: LaunchdOptions = {}) {
    this.runner = options.runner ?? systemRunner;
    this.uid = options.uid ?? userId();
    this.home = options.home ?? homedir();
    this.root = options.root ?? repositoryRoot;
    this.labels = options.labels ?? findLaunchdLabels(readAgentDirectory(this.home));
    this.logDirectory = options.logDirectory ?? join(this.home, 'Library/Logs/Ongoing');
    this.wait = options.wait ?? sleep;
  }

  private get domain(): string {
    return `gui/${this.uid}`;
  }

  private plist(service: HostService): string {
    return join(this.home, 'Library/LaunchAgents', `${this.labels[service]}.plist`);
  }

  async status(service: HostService): Promise<HostServiceStatus> {
    const label = this.labels[service];
    const result = this.runner('launchctl', ['print', `${this.domain}/${label}`]);
    if (result.status !== 0)
      return {
        service,
        adapter: this.name,
        label,
        state: 'not loaded',
        running: false,
        pid: null,
        detail: null
      };
    const parsed = parseLaunchdPrint(result.stdout);
    return {
      service,
      adapter: this.name,
      label,
      state: parsed.state,
      running: parsed.running,
      pid: parsed.pid,
      detail:
        parsed.lastExitStatus !== null && parsed.lastExitStatus !== 0
          ? `last exit code ${parsed.lastExitStatus}`
          : null
    };
  }

  /**
   * bootout + bootstrap rather than `kickstart -k`, so an edited plist is actually reloaded.
   * bootout is asynchronous: bootstrapping before launchd has torn the job down fails with
   * "Input/output error", so the label has to disappear first.
   */
  async restart(
    service: HostService,
    options: { build?: boolean } = {}
  ): Promise<HostActionResult> {
    const label = this.labels[service];
    if (options.build && service === 'web') {
      const built = this.runner(process.execPath, ['run', 'build'], {
        cwd: this.root,
        stdio: 'inherit'
      });
      if (built.status !== 0) return { ok: false, message: 'build failed; service left running' };
    }
    this.runner('launchctl', ['bootout', `${this.domain}/${label}`]);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await this.status(service)).state === 'not loaded') break;
      await this.wait(300);
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = this.runner('launchctl', ['bootstrap', this.domain, this.plist(service)]);
      if (result.status === 0) return { ok: true, message: `restarted ${label}` };
      if (attempt === 5)
        return {
          ok: false,
          message: `launchctl bootstrap ${label} failed: ${commandFailed(result)}`
        };
      await this.wait(500);
    }
    return { ok: false, message: `launchctl bootstrap ${label} failed` };
  }

  async stop(service: HostService): Promise<HostActionResult> {
    const label = this.labels[service];
    const result = this.runner('launchctl', ['bootout', `${this.domain}/${label}`]);
    return result.status === 0
      ? { ok: true, message: `stopped ${label}` }
      : { ok: true, message: `${label} was not loaded` };
  }

  logs(service: HostService): HostLogTarget {
    const prefix = service === 'scan' ? 'scan-' : '';
    return {
      files: [
        join(this.logDirectory, `${prefix}stdout.log`),
        join(this.logDirectory, `${prefix}stderr.log`)
      ],
      detail: null
    };
  }

  serve(options: ServeOptions = {}): Promise<number> {
    return serveInForeground(options, this.root);
  }

  scan(options: HostScanOptions = {}): Promise<number> {
    return scanInForeground(options, this.root);
  }
}
