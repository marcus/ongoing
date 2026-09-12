import { collectGitHubEnrichment } from '$lib/server/collectors/github';
import { discoverRemoteRepositories } from '$lib/server/collectors/github-discovery';
import type { AppConfig } from '$lib/server/config';
import { GitHubHttpClient } from '$lib/server/github/client';
import { listOwnerRepositories } from '$lib/server/github/discovery';
import { GitHubHostingMetricsProvider } from '$lib/server/github/provider';
import { refreshReleaseBaselines } from '$lib/server/releases/baseline';
import { EndOfLifeProvider } from '$lib/server/releases/endoflife';
import type { ScannerDependencies } from './scanner';

/**
 * The production collector wiring, shared by the web service (`runtime.ts`) and the daily scan
 * agent (`src/lib/host/scan-command.ts`). Both run real scans, so both must enrich identically —
 * the scan agent is in fact the only one that runs on a schedule.
 */
export function createScannerDependencies(config: AppConfig): ScannerDependencies {
  const githubClient = new GitHubHttpClient();
  const githubProvider = new GitHubHostingMetricsProvider(githubClient);
  const releaseProvider = new EndOfLifeProvider({ apiUrl: config.releaseBaselineApiUrl });
  return {
    collectHosting: (repository, projects, options) =>
      collectGitHubEnrichment(repository, projects, {
        ...options,
        provider: githubProvider,
        now: () => new Date()
      }),
    // Undefined when no owner is configured, so the scanner reports the step as not run rather
    // than as a pass that found nothing.
    discoverRemote: config.githubDiscoverOwners.length
      ? (repository, options) =>
          discoverRemoteRepositories(repository, {
            ...options,
            owners: config.githubDiscoverOwners,
            includeForks: config.githubDiscoverForks,
            includeArchived: config.githubDiscoverArchived,
            list: (owner, signal) => listOwnerRepositories(githubClient, owner, signal)
          })
      : undefined,
    refreshReleaseBaselines: config.releaseBaselineEnabled
      ? async (repository, options) => {
          await refreshReleaseBaselines(repository, {
            ...options,
            provider: releaseProvider,
            maxAgeHours: config.releaseBaselineMaxAgeHours
          });
        }
      : undefined
  };
}
