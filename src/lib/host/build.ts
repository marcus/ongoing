import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot, systemRunner } from './run';
import type { HostCommandRunner } from './adapter';

/** Pin a real directory before importing: later builds cannot change lazy imports or assets. */
export function pinBuild(root: string): string {
  const built = join(root, 'build');
  if (lstatSync(built).isSymbolicLink()) return realpathSync(built);
  // Upgrade an old installation without moving files underneath its running process.
  const snapshot = join(root, '.ongoing-builds', `legacy-${randomUUID()}`);
  cpSync(built, snapshot, { recursive: true });
  return snapshot;
}

/** Build away from live artifacts; publish only a complete adapter bundle. Never prune live builds. */
export function buildApplication(
  root = repositoryRoot,
  runner: HostCommandRunner = systemRunner
): number {
  const built = join(root, 'build');
  if (existsSync(built) && !lstatSync(built).isSymbolicLink())
    throw new Error(
      'Legacy build directory: stop the service and adopt it as an immutable build first; see docs/deployment.md.'
    );
  const builds = join(root, '.ongoing-builds');
  mkdirSync(builds, { recursive: true });
  const lock = join(builds, 'build.lock');
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(
      'Another build is running (or left .ongoing-builds/build.lock after interruption).'
    );
  }
  const id = randomUUID();
  const output = join(builds, id);
  const pointer = join(root, `.ongoing-build-${id}`);
  try {
    const result = runner(process.execPath, ['--bun', 'vite', 'build'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ONGOING_BUILD_OUTPUT: output }
    });
    if (result.status !== 0) return result.status;
    if (!existsSync(join(output, 'handler.js'))) throw new Error('Build produced no handler.js');
    symlinkSync(join('.ongoing-builds', id), pointer, 'dir');
    renameSync(pointer, built);
    console.log(`Built ${id}; restart the service to activate it.`);
    return 0;
  } finally {
    rmSync(pointer, { force: true });
    rmSync(lock, { recursive: true });
  }
}

if (import.meta.main) process.exitCode = buildApplication();
