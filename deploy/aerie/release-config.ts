import { isAbsolute } from 'node:path';

export const PRODUCTION_HOST = 'marcus@aerie.local';
export const PRODUCTION_CHECKOUT = '/Users/marcus/code/ongoing';
export const PRODUCTION_DATABASE =
  '/Users/marcus/Library/Application Support/Ongoing/ongoing.sqlite';
export const PRODUCTION_WEB_LABEL = 'com.marcusvorwaller.ongoing';
export const PRODUCTION_SCAN_LABEL = 'com.marcusvorwaller.ongoing.scan';
export const PRODUCTION_WEB_PLIST =
  '/Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.plist';
export const PRODUCTION_SCAN_PLIST =
  '/Users/marcus/Library/LaunchAgents/com.marcusvorwaller.ongoing.scan.plist';
// Stable, version-free path. deploy/aerie/provision-runtime.sh points it at the release named in .bun-version.
export const PRODUCTION_BUN = '/Users/marcus/.local/share/ongoing/bun';
// The scanner's own PATH, with no shell configuration behind it. `gh` is installed through mise on
// this machine rather than Homebrew, so its shim directory has to be on the list or the hosting
// collector reports GitHub unavailable on every scheduled scan. A mise shim resolves the tool from
// the user's own config, which launchd supplies (it always sets HOME), so the dependency is real
// but bounded. This constant, and everything else in this directory, is the aerie deployment
// profile: the core never imports it, and another machine writes its own profile beside it.
export const PRODUCTION_SCAN_PATH =
  '/Users/marcus/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';

export interface ReleaseConfig {
  host: string;
  checkout: string;
  database: string;
  webLabel: string;
  scanLabel: string;
  webPlist: string;
  scanPlist: string;
  bunExecutable: string;
  healthUrl: string;
  backupRetention: number;
}

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseReleaseArgs(args: string[]): {
  config: ReleaseConfig;
  dryRun: boolean;
  restoreDatabase: boolean;
} {
  const host = value(args, '--host');
  const checkout = value(args, '--checkout');
  const database = value(args, '--database');
  if (!host || !checkout || !database)
    throw new Error('--host, --checkout, and --database are required explicit targets');
  if (host !== PRODUCTION_HOST) throw new Error(`host must be exactly ${PRODUCTION_HOST}`);
  if (checkout !== PRODUCTION_CHECKOUT || !isAbsolute(checkout))
    throw new Error(`checkout must be exactly ${PRODUCTION_CHECKOUT}`);
  if (database !== PRODUCTION_DATABASE || !isAbsolute(database))
    throw new Error(`database must be exactly ${PRODUCTION_DATABASE}`);
  const allowed = new Set([
    '--host',
    '--checkout',
    '--database',
    '--dry-run',
    '--restore-database'
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!allowed.has(argument)) throw new Error(`unknown argument: ${argument}`);
    if (['--host', '--checkout', '--database'].includes(argument)) index += 1;
  }
  return {
    config: {
      host,
      checkout,
      database,
      webLabel: PRODUCTION_WEB_LABEL,
      scanLabel: PRODUCTION_SCAN_LABEL,
      webPlist: PRODUCTION_WEB_PLIST,
      scanPlist: PRODUCTION_SCAN_PLIST,
      bunExecutable: PRODUCTION_BUN,
      healthUrl: 'http://127.0.0.1:7766/api/health',
      backupRetention: 5
    },
    dryRun: args.includes('--dry-run'),
    restoreDatabase: args.includes('--restore-database')
  };
}

export function encodeReleaseConfig(config: ReleaseConfig): string {
  return Buffer.from(JSON.stringify(config)).toString('base64url');
}

export function decodeReleaseConfig(encoded: string): ReleaseConfig {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('release config must be base64url');
  const config = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as ReleaseConfig;
  const parsed = parseReleaseArgs([
    '--host',
    config.host,
    '--checkout',
    config.checkout,
    '--database',
    config.database
  ]).config;
  if (
    config.webLabel !== parsed.webLabel ||
    config.scanLabel !== parsed.scanLabel ||
    config.webPlist !== parsed.webPlist ||
    config.scanPlist !== parsed.scanPlist ||
    config.bunExecutable !== parsed.bunExecutable ||
    config.healthUrl !== parsed.healthUrl ||
    config.backupRetention !== parsed.backupRetention
  )
    throw new Error('release config contains unsupported targets');
  return parsed;
}

export function releasePlan(
  mode: 'deploy' | 'rollback',
  config: ReleaseConfig,
  restoreDatabase = false
): string[] {
  return mode === 'deploy'
    ? [
        `provision app-scoped ${config.bunExecutable} from .bun-version`,
        `verify clean checkout ${config.checkout}`,
        `record current SHA for ${config.checkout}`,
        'fetch origin main and fast-forward only',
        `provision ${config.bunExecutable} from the fetched .bun-version`,
        `validate ${PRODUCTION_SCAN_PATH} resolves gh, td, cloc, and git for the daily scanner`,
        `quiesce ${config.webLabel} and ${config.scanLabel}`,
        `back up ${config.database} and retain ${config.backupRetention} backups`,
        `install frozen lockfile and build with ${config.bunExecutable}`,
        `apply migrations with ${config.bunExecutable} scripts/migrate.ts`,
        `install ${config.webPlist} and ${config.scanPlist} from committed definitions`,
        `bootstrap calendar LaunchAgent ${config.scanLabel} without an immediate scan`,
        `bootstrap web LaunchAgent ${config.webLabel}`,
        `wait for ${config.healthUrl}`,
        'record deployed SHA'
      ]
    : [
        `provision app-scoped ${config.bunExecutable} from .bun-version`,
        `verify clean checkout ${config.checkout}`,
        `read and validate ${config.checkout}/.deploy/release.json`,
        `quiesce ${config.webLabel} and ${config.scanLabel}`,
        `back up ${config.database} and retain ${config.backupRetention} backups`,
        'switch to recorded prior SHA',
        `provision ${config.bunExecutable} from the selected .bun-version`,
        `install frozen lockfile and build with ${config.bunExecutable}`,
        ...(restoreDatabase ? ['restore the recorded pre-deploy database backup'] : []),
        `restore ${config.webPlist} and ${config.scanPlist} from the selected commit`,
        `bootstrap calendar LaunchAgent ${config.scanLabel} without an immediate scan`,
        `bootstrap web LaunchAgent ${config.webLabel}`,
        `wait for ${config.healthUrl}`
      ];
}
