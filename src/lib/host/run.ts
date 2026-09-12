import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult, HostCommandRunner, HostScanOptions, ServeOptions } from './adapter';

/** The repository this code was loaded from: `src/lib/host/run.ts` sits three levels below it. */
export const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

export const systemRunner: HostCommandRunner = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8'
  });
  if (result.error) return { status: 1, stdout: '', stderr: result.error.message };
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
};

export function userId(): number {
  return process.getuid?.() ?? 501;
}

/**
 * The environment a served or scanned process runs with. `--data-dir` is the whole of "a fresh
 * install": a directory nobody has written to yet becomes a catalog on first open.
 */
export function runEnvironment(
  options: ServeOptions | HostScanOptions,
  base: Record<string, string | undefined> = process.env
): Record<string, string> {
  const env: Record<string, string | undefined> = { ...base, ...options.env };
  const databasePath =
    options.databasePath ??
    (options.dataDir ? join(resolve(options.dataDir), 'ongoing.sqlite') : undefined);
  if (databasePath) env.DATABASE_PATH = databasePath;
  if ('host' in options && options.host) env.HOST = options.host;
  if ('port' in options && options.port) env.PORT = String(options.port);
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined)
  ) as Record<string, string>;
}

/** The built adapter bundle the production server needs. */
export function buildExists(root = repositoryRoot): boolean {
  return existsSync(join(root, 'build', 'handler.js'));
}

/**
 * Runs the application in the foreground until it exits. Shared by every host adapter: what a host
 * differs about is supervision, not how the process starts.
 */
export async function serveInForeground(
  options: ServeOptions = {},
  root = repositoryRoot
): Promise<number> {
  const env = runEnvironment(options, process.env);
  if (!buildExists(root)) {
    if (options.build === false)
      throw new Error(
        `No adapter bundle in ${join(root, 'build')} — run \`bun run build\` or pass --build`
      );
    const built = systemRunner(process.execPath, ['run', 'build'], {
      cwd: root,
      stdio: 'inherit'
    });
    if (built.status !== 0) throw new Error('build failed; the server was not started');
  }
  const child = spawn(process.execPath, [join(root, 'src/lib/host/production-server.ts')], {
    cwd: root,
    env,
    stdio: 'inherit'
  });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    return await new Promise<number>((done) => {
      child.on('exit', (code) => done(code ?? 0));
      child.on('error', () => done(1));
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

/** Runs one scan in a child process so the catalog is opened and closed by that process alone. */
export async function scanInForeground(
  options: HostScanOptions = {},
  root = repositoryRoot
): Promise<number> {
  const args = [join(root, 'src/lib/host/scan-command.ts')];
  if (options.full) args.push('--full');
  if (options.cheap) args.push('--cheap');
  if (options.projectId) args.push('--project', options.projectId);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: runEnvironment(options, process.env),
    stdio: 'inherit'
  });
  return new Promise<number>((done) => {
    child.on('exit', (code) => done(code ?? 0));
    child.on('error', () => done(1));
  });
}

export function commandFailed(result: CommandResult): string {
  return (result.stderr || result.stdout || `exit code ${result.status}`).trim();
}
