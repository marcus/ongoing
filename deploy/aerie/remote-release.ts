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
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { decodeReleaseConfig, PRODUCTION_SCAN_PATH, type ReleaseConfig } from './release-config';

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

async function commandSucceeds(argv: string[], cwd: string): Promise<boolean> {
  const child = Bun.spawn(argv, { cwd, stdout: 'ignore', stderr: 'ignore' });
  return (await child.exited) === 0;
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

function userId(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('user LaunchAgent operation requires a Unix user ID');
  return uid;
}

function validateInvocation(config: ReleaseConfig): void {
  // Bun reports the resolved binary as execPath, and the app-scoped path is a symlink to it.
  if (realpathSync(process.execPath) !== realpathSync(config.bunExecutable))
    throw new Error(`release must run with ${config.bunExecutable}`);
}

// The checkout's .bun-version is the only place the runtime version is declared. Re-run provisioning
// whenever the checkout moves so a version bump installs itself and re-points the stable executable
// before anything is built with it; the release process itself may keep running on the previous Bun.
async function provisionRuntime(config: ReleaseConfig): Promise<void> {
  await command(
    ['/bin/zsh', join(config.checkout, 'deploy', 'aerie', 'provision-runtime.sh')],
    config.checkout
  );
  const pinned = (await readFile(join(config.checkout, '.bun-version'), 'utf8')).trim();
  const actual = await command([config.bunExecutable, '--version'], config.checkout);
  if (actual !== pinned) throw new Error(`Bun version mismatch: expected ${pinned}, got ${actual}`);
}

async function validateScanTooling(config: ReleaseConfig): Promise<void> {
  const definition = await readFile(
    join(config.checkout, 'deploy', 'aerie', 'config', 'ongoing-scan.plist.example'),
    'utf8'
  );
  const configuredPath = /<key>PATH<\/key>\s*<string>([^<]+)<\/string>/.exec(definition)?.[1];
  if (configuredPath !== PRODUCTION_SCAN_PATH)
    throw new Error(`scan LaunchAgent PATH must be exactly ${PRODUCTION_SCAN_PATH}`);
  for (const probe of [
    ['gh', '--version'],
    ['td', '--version'],
    ['cloc', '--version'],
    ['git', '--version']
  ])
    await command(probe, config.checkout, { PATH: PRODUCTION_SCAN_PATH });
}

async function quiesce(config: ReleaseConfig): Promise<void> {
  const uid = userId();
  for (const label of [config.scanLabel, config.webLabel]) {
    const target = `gui/${uid}/${label}`;
    if (await commandSucceeds(['launchctl', 'print', target], config.checkout))
      await command(['launchctl', 'bootout', target], config.checkout);
  }
}

function accessSecret(plist: string): string {
  const match = /<key>ONGOING_ACCESS_SECRET<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  if (!match || match[1].includes('REPLACE_OUTSIDE_GIT'))
    throw new Error('installed web LaunchAgent must contain its machine-local access secret');
  return match[1];
}

async function installDefinition(source: string, destination: string, content?: string) {
  const value = content ?? (await readFile(source, 'utf8'));
  const temporary = `${destination}.new`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, destination);
}

async function installAgentDefinitions(config: ReleaseConfig): Promise<void> {
  const webSource = join(config.checkout, 'deploy', 'aerie', 'config', 'ongoing.plist.example');
  const scanSource = join(
    config.checkout,
    'deploy',
    'aerie',
    'config',
    'ongoing-scan.plist.example'
  );
  const installedWeb = await readFile(config.webPlist, 'utf8');
  const secret = accessSecret(installedWeb);
  const webDefinition = (await readFile(webSource, 'utf8')).replace(
    'REPLACE_OUTSIDE_GIT_WITH_A_LONG_RANDOM_SECRET',
    () => secret
  );
  await mkdir(dirname(config.webPlist), { recursive: true });
  await mkdir('/Users/marcus/Library/Logs/Ongoing', { recursive: true });
  await installDefinition(webSource, config.webPlist, webDefinition);
  await installDefinition(scanSource, config.scanPlist);
}

async function startAgents(config: ReleaseConfig): Promise<void> {
  const domain = `gui/${userId()}`;
  // The scan definition deliberately has neither RunAtLoad nor KeepAlive, so bootstrapping it
  // only registers the 04:00 calendar event. The web definition starts immediately.
  await command(['launchctl', 'bootstrap', domain, config.scanPlist], config.checkout);
  await command(['launchctl', 'bootstrap', domain, config.webPlist], config.checkout);
  await waitForHealth(config.healthUrl);
}

async function deploy(config: ReleaseConfig, recordPath: string): Promise<void> {
  validateInvocation(config);
  if (await command(['git', 'status', '--porcelain'], config.checkout))
    throw new Error('production checkout is not clean');
  await command(['git', 'switch', 'main'], config.checkout);
  const priorSha = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  await command(['git', 'fetch', 'origin', 'main'], config.checkout);
  await command(['git', 'merge', '--ff-only', 'origin/main'], config.checkout);
  await provisionRuntime(config);
  await validateScanTooling(config);
  const deployedSha = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  await quiesce(config);
  const backup = await backupDatabase(config, priorSha);
  await command([config.bunExecutable, 'install', '--frozen-lockfile'], config.checkout);
  await command([config.bunExecutable, 'run', 'build'], config.checkout);
  await command([config.bunExecutable, 'run', 'scripts/migrate.ts'], config.checkout, {
    DATABASE_PATH: config.database
  });
  await installAgentDefinitions(config);
  await startAgents(config);
  await record(recordPath, { priorSha, deployedSha, backup, recordedAt: new Date().toISOString() });
  console.log(`Deployed ${deployedSha}; prior ${priorSha}.`);
}

async function rollback(
  config: ReleaseConfig,
  recordPath: string,
  restoreDatabase: boolean
): Promise<void> {
  validateInvocation(config);
  if (await command(['git', 'status', '--porcelain'], config.checkout))
    throw new Error('production checkout is not clean');
  const release = JSON.parse(await readFile(recordPath, 'utf8')) as ReleaseRecord;
  if (!/^[a-f0-9]{40}$/.test(release.priorSha)) throw new Error('recorded prior SHA is invalid');
  const current = await command(['git', 'rev-parse', 'HEAD'], config.checkout);
  await quiesce(config);
  const safetyBackup = await backupDatabase(config, current);
  await command(['git', 'switch', '--detach', release.priorSha], config.checkout);
  await provisionRuntime(config);
  await command([config.bunExecutable, 'install', '--frozen-lockfile'], config.checkout);
  await command([config.bunExecutable, 'run', 'build'], config.checkout);
  if (restoreDatabase) {
    if (!release.backup) throw new Error('release record has no database backup');
    if (dirname(resolve(release.backup)) !== resolve(`${config.database}.backups`))
      throw new Error('recorded database backup is outside the managed backup directory');
    await copyFile(release.backup, config.database);
    await Promise.all([
      removeIfPresent(`${config.database}-shm`),
      removeIfPresent(`${config.database}-wal`)
    ]);
  }
  await installAgentDefinitions(config);
  await startAgents(config);
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
