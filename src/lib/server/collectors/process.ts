export interface CommandOptions {
  cwd: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string | undefined>;
}

export interface CommandResult {
  command: readonly string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CommandRunner = (
  command: readonly string[],
  options: CommandOptions
) => Promise<CommandResult>;

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: CommandResult
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const FORCE_KILL_DELAY_MS = 250;

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') throw error;
  }
}

/**
 * Run a bounded subprocess without involving a command shell.
 *
 * `detached` makes the child a process-group leader on POSIX. The timeout then
 * terminates the entire group, including helpers a collector command may have
 * started, and escalates to SIGKILL after a short grace period.
 */
export const runCommand: CommandRunner = async (command, options) => {
  if (command.length === 0) throw new TypeError('A command must contain an executable');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('Command timeout must be positive');

  const spawnOptions: Bun.SpawnOptions.OptionsObject<'ignore', 'pipe', 'pipe'> & {
    cmd: string[];
    detached: boolean;
  } = {
    cmd: [...command],
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
    // Bun's timeout is a final safety net; the timer below kills the process group.
    timeout: timeoutMs + FORCE_KILL_DELAY_MS * 2,
    killSignal: 'SIGKILL',
    maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
  };
  const subprocess = Bun.spawn(spawnOptions);

  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    signalProcessGroup(subprocess.pid, 'SIGTERM');
    forceKillTimer = setTimeout(
      () => signalProcessGroup(subprocess.pid, 'SIGKILL'),
      FORCE_KILL_DELAY_MS
    );
  }, timeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ]);
  clearTimeout(timeout);
  if (forceKillTimer) clearTimeout(forceKillTimer);

  return {
    command: [...command],
    cwd: options.cwd,
    exitCode,
    stdout,
    stderr,
    timedOut
  };
};

export async function runSuccessfulCommand(
  command: readonly string[],
  options: CommandOptions
): Promise<string> {
  const result = await runCommand(command, options);
  if (result.timedOut)
    throw new CommandError(
      `Command timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      result
    );
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `exit code ${String(result.exitCode)}`;
    throw new CommandError(`Command failed: ${detail}`, result);
  }
  return result.stdout;
}
