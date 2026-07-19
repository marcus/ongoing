import { CatalogDatabase } from '../src/lib/server/catalog/database';
import { CatalogRepository } from '../src/lib/server/catalog/repository';
import { loadConfig } from '../src/lib/server/config';
import { collectGitHubEnrichment } from '../src/lib/server/collectors/github';
import { GitHubHttpClient } from '../src/lib/server/github/client';
import { GitHubHostingMetricsProvider } from '../src/lib/server/github/provider';
import {
  ScanInProgressError,
  Scanner,
  type RefreshPolicy
} from '../src/lib/server/scanning/scanner';

function usage(): void {
  console.log('Usage: bun run scan [--full|--cheap] [--project PROJECT_ID]');
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}
let projectId: string | undefined;
let refresh: RefreshPolicy = 'changed';
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--full') refresh = 'full';
  else if (argument === '--cheap') refresh = 'cheap';
  else if (argument === '--project' && args[index + 1]) projectId = args[++index];
  else {
    console.error(`Unknown or incomplete argument: ${argument}`);
    usage();
    process.exit(2);
  }
}

const config = loadConfig();
const database = new CatalogDatabase(config.databasePath);
try {
  const repository = new CatalogRepository(database);
  const githubProvider = new GitHubHostingMetricsProvider(new GitHubHttpClient());
  const scanner = new Scanner(repository, config, {
    collectHosting: (catalog, projects, options) =>
      collectGitHubEnrichment(catalog, projects, {
        ...options,
        provider: githubProvider,
        now: () => new Date()
      })
  });
  const result = await scanner.scan({
    reason: projectId ? 'project' : 'cli',
    projectId,
    refresh
  });
  console.log(JSON.stringify(result));
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  if (error instanceof ScanInProgressError)
    console.error(`Scan already running${error.runId ? `: ${error.runId}` : ''}`);
  else console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  database.close();
}
