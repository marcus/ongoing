import { isAbsolute } from 'node:path';

export const PRODUCTION_HOST = 'marcus@aerie.local';
export const PRODUCTION_CHECKOUT = '/Users/marcusvorwaller/code/ongoing';
export const PRODUCTION_DATABASE =
  '/Users/marcusvorwaller/Library/Application Support/Ongoing/ongoing.sqlite';
export const PRODUCTION_LABEL = 'com.marcusvorwaller.ongoing';

export interface ReleaseConfig {
  host: string;
  checkout: string;
  database: string;
  label: string;
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
      label: PRODUCTION_LABEL,
      healthUrl: 'http://127.0.0.1:4173/api/health',
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
    config.label !== parsed.label ||
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
  const common = [
    `verify clean checkout ${config.checkout}`,
    `record current SHA under ${config.checkout}/.deploy`,
    `back up ${config.database} and retain ${config.backupRetention} backups`
  ];
  return mode === 'deploy'
    ? [
        ...common,
        'fetch origin main and fast-forward only',
        'install frozen lockfile and build',
        'apply migrations',
        `restart user LaunchAgent ${config.label}`,
        `wait for ${config.healthUrl}`,
        'record deployed SHA'
      ]
    : [
        ...common,
        'switch to recorded prior SHA',
        ...(restoreDatabase ? ['restore the recorded pre-deploy database backup'] : []),
        'install frozen lockfile and build',
        `restart user LaunchAgent ${config.label}`,
        `wait for ${config.healthUrl}`
      ];
}
