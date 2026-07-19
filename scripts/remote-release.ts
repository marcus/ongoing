import { Database } from 'bun:sqlite';
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { decodeReleaseConfig, type ReleaseConfig } from './release-config';

interface ReleaseRecord {
  priorSha: string;
  deployedSha: string;
  backup?: string;
  recordedAt: string;
}

async function command(argv: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const child = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'inherit'
  });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) throw new Error(`command failed: ${argv[0]} ${argv[1] ?? ''}`);
  return output.trim();
}

async function record(path: string, value: ReleaseRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.new`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
}

async function backupDatabase(
  config: ReleaseConfig,
  priorSha: string
): Promise<string | undefined> {
  const directory = `${config.database}.backups`;
  await mkdir(directory, { recursive: true });
  const backup = join(
    directory,
    `ongoing-${new Date().toISOString().replace(/[:.]/g, '-')}-${priorSha.slice(0, 12)}.sqlite`
  );
  try {
    await stat(config.database);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined;
    throw error;
  }
  const database = new Database(config.database, { readonly: true });
  database.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  database.close();
  const backups = (await readdir(directory))
    .filter((name) => name.endsWith('.sqlite'))
    .sort()
    .reverse();
  await Promise.all(
    backups.slice(config.backupRetention).map((name) => unlink(join(directory, name)))
  );
  return backup;
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && JSON.stringify(await response.json()) === '{"ok":true}') return;
    } catch {
      /* service is still starting */
    }
    await Bun.sleep(500);
  }
  throw new Error('service did not become healthy within 30 seconds');
}

async function restart(config: ReleaseConfig): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('user LaunchAgent restart requires a Unix user ID');
  await command(['launchctl', 'kickstart', '-k', `gui/${uid}/${config.label}`], config.checkout);
  await waitForHealth(config.healthUrl);
}

async function deploy(config: ReleaseConfig, recordPath: string): Promise<void> {
  if (await command(['git', 'status', '--porcelain'], config.checkout))
    throw new Error('production checkout is not clean');
  await command(['git', 'switch', 'main'], config.checkout);
  const priorSha = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  const backup = await backupDatabase(config, priorSha);
  await command(['git', 'fetch', 'origin', 'main'], config.checkout);
  await command(['git', 'merge', '--ff-only', 'origin/main'], config.checkout);
  const deployedSha = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  await command(['bun', 'install', '--frozen-lockfile'], config.checkout);
  await command(['bun', 'run', 'build'], config.checkout);
  await command(['bun', 'run', 'scripts/migrate.ts'], config.checkout, {
    DATABASE_PATH: config.database
  });
  await record(recordPath, { priorSha, deployedSha, backup, recordedAt: new Date().toISOString() });
  await restart(config);
  console.log(`Deployed ${deployedSha}; prior ${priorSha}.`);
}

async function rollback(
  config: ReleaseConfig,
  recordPath: string,
  restoreDatabase: boolean
): Promise<void> {
  if (await command(['git', 'status', '--porcelain'], config.checkout))
    throw new Error('production checkout is not clean');
  const release = JSON.parse(await readFile(recordPath, 'utf8')) as ReleaseRecord;
  if (!/^[a-f0-9]{40}$/.test(release.priorSha)) throw new Error('recorded prior SHA is invalid');
  const current = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  const safetyBackup = await backupDatabase(config, current);
  await command(['git', 'switch', '--detach', release.priorSha], config.checkout);
  await command(['bun', 'install', '--frozen-lockfile'], config.checkout);
  await command(['bun', 'run', 'build'], config.checkout);
  if (restoreDatabase) {
    if (!release.backup) throw new Error('release record has no database backup');
    if (dirname(resolve(release.backup)) !== resolve(`${config.database}.backups`))
      throw new Error('recorded database backup is outside the managed backup directory');
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error('database restore requires a Unix user ID');
    await command(['launchctl', 'kill', 'SIGTERM', `gui/${uid}/${config.label}`], config.checkout);
    await copyFile(release.backup, config.database);
    await Promise.all([
      removeIfPresent(`${config.database}-shm`),
      removeIfPresent(`${config.database}-wal`)
    ]);
  }
  await restart(config);
  await record(recordPath, {
    priorSha: current,
    deployedSha: release.priorSha,
    backup: safetyBackup,
    recordedAt: new Date().toISOString()
  });
  console.log(`Rolled back to ${release.priorSha}.`);
}

const [mode, encoded, option] = process.argv.slice(2);
if (!['deploy', 'rollback'].includes(mode) || !encoded)
  throw new Error('remote release invocation is invalid');
const config = decodeReleaseConfig(encoded);
const recordPath = join(config.checkout, '.deploy', 'release.json');
if (mode === 'deploy') await deploy(config, recordPath);
else await rollback(config, recordPath, option === '--restore-database');
