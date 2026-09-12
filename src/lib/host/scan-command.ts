import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { loadRuntimeConfig, type AppConfig } from '$lib/server/config';
import { activeProviderNames } from '$lib/server/providers/registry';
import { createScannerDependencies } from '$lib/server/scanning/dependencies';
import { ScanInProgressError, Scanner, type RefreshPolicy } from '$lib/server/scanning/scanner';

/**
 * One scan, outside the web process: the daily agent, `ongoing scan` with no service running, and
 * the `foreground` host all come through here. `scripts/scan.ts` is a shim onto it because the
 * installed scan LaunchAgent names that path.
 */
export interface ScanCommandOptions {
  projectId?: string;
  refresh?: RefreshPolicy;
  config?: AppConfig;
}

export interface ScanCommandResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  discoveredCount: number;
  updatedCount: number;
  errorCount: number;
  forgottenCount: number;
}

export function parseScanArgs(args: readonly string[]): ScanCommandOptions {
  const options: ScanCommandOptions = { refresh: 'changed' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--full') options.refresh = 'full';
    else if (argument === '--cheap') options.refresh = 'cheap';
    else if (argument === '--changed') options.refresh = 'changed';
    else if (argument === '--project' && args[index + 1]) options.projectId = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return options;
}

export async function runScanCommand(options: ScanCommandOptions = {}): Promise<ScanCommandResult> {
  const config = options.config ?? loadRuntimeConfig();
  const database = new CatalogDatabase(config.databasePath);
  try {
    const repository = new CatalogRepository(database, undefined, {
      providers: activeProviderNames(config)
    });
    const scanner = new Scanner(repository, config, createScannerDependencies(config));
    return await scanner.scan({
      reason: options.projectId ? 'project' : 'cli',
      projectId: options.projectId,
      refresh: options.refresh
    });
  } finally {
    database.close();
  }
}

export const scanUsage = 'Usage: bun run scan [--full|--cheap] [--project PROJECT_ID]';

/** The CLI entry point both `scripts/scan.ts` and `ongoing scan --local` share. */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(scanUsage);
    return 0;
  }
  let options: ScanCommandOptions;
  try {
    options = parseScanArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.log(scanUsage);
    return 2;
  }
  try {
    const result = await runScanCommand(options);
    console.log(JSON.stringify(result));
    return result.status === 'completed' ? 0 : 1;
  } catch (error) {
    if (error instanceof ScanInProgressError)
      console.error(`Scan already running${error.runId ? `: ${error.runId}` : ''}`);
    else console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
