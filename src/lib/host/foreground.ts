import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  HostActionResult,
  HostAdapter,
  HostLogTarget,
  HostScanOptions,
  HostService,
  HostServiceStatus,
  ServeOptions
} from './adapter';
import { repositoryRoot, scanInForeground, serveInForeground } from './run';

/**
 * The foreground host: no supervisor at all.
 *
 * This is the second implementation of the host seam and the one a machine that is not aerie runs:
 * `ongoing serve --data-dir ./tmp` starts the application in the terminal, `ongoing scan` runs one
 * scan, `stop` signals whatever this host recorded a pid for, and `logs` says plainly that a
 * foreground process logs to the terminal it was started in.
 */
export interface ForegroundOptions {
  root?: string;
  stateDirectory?: string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

export class ForegroundHost implements HostAdapter {
  readonly name = 'foreground';
  private readonly root: string;
  private readonly stateDirectory: string;
  private readonly kill: (pid: number, signal: NodeJS.Signals) => void;

  constructor(options: ForegroundOptions = {}) {
    this.root = options.root ?? repositoryRoot;
    this.stateDirectory = options.stateDirectory ?? join(homedir(), '.local/state/ongoing');
    this.kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  }

  private pidFile(service: HostService): string {
    return join(this.stateDirectory, `${service}.pid`);
  }

  private readPid(service: HostService): number | null {
    try {
      const pid = Number(readFileSync(this.pidFile(service), 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private writePid(service: HostService, pid: number): void {
    mkdirSync(this.stateDirectory, { recursive: true });
    writeFileSync(this.pidFile(service), `${pid}\n`);
  }

  private clearPid(service: HostService): void {
    rmSync(this.pidFile(service), { force: true });
  }

  async status(service: HostService): Promise<HostServiceStatus> {
    const pid = this.readPid(service);
    let running = false;
    if (pid !== null) {
      try {
        this.kill(pid, 'SIGCONT' as NodeJS.Signals);
        running = true;
      } catch {
        running = false;
      }
    }
    return {
      service,
      adapter: this.name,
      label: null,
      state: running ? 'running' : pid === null ? 'unmanaged' : 'stopped',
      running,
      pid: running ? pid : null,
      detail: running ? null : 'a foreground host supervises nothing; start it with `ongoing serve`'
    };
  }

  async restart(): Promise<HostActionResult> {
    return {
      ok: false,
      message:
        'The foreground host does not supervise anything to restart — stop the process and run `ongoing serve` again.'
    };
  }

  async stop(service: HostService): Promise<HostActionResult> {
    const pid = this.readPid(service);
    if (pid === null) return { ok: true, message: `no foreground ${service} process is recorded` };
    try {
      this.kill(pid, 'SIGTERM');
      this.clearPid(service);
      return { ok: true, message: `signalled foreground ${service} process ${pid}` };
    } catch (error) {
      this.clearPid(service);
      return {
        ok: false,
        message: `unable to signal ${pid}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  logs(): HostLogTarget {
    return {
      files: [],
      detail: 'A foreground process writes to the terminal it was started in; there is no log file.'
    };
  }

  async serve(options: ServeOptions = {}): Promise<number> {
    this.writePid('web', process.pid);
    try {
      return await serveInForeground(options, this.root);
    } finally {
      if (existsSync(this.pidFile('web'))) this.clearPid('web');
    }
  }

  scan(options: HostScanOptions = {}): Promise<number> {
    return scanInForeground(options, this.root);
  }
}
