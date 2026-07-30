import { collectGitHubEnrichment } from '$lib/server/collectors/github';
import type { AppConfig } from '$lib/server/config';
import { GitHubHttpClient } from '$lib/server/github/client';
import { GitHubHostingMetricsProvider } from '$lib/server/github/provider';
import { refreshReleaseBaselines } from '$lib/server/releases/baseline';
import { EndOfLifeProvider } from '$lib/server/releases/endoflife';
import type { ScannerDependencies } from './scanner';

/**
 * The production collector wiring, shared by the web service (`runtime.ts`) and the daily scan
 * agent (`scripts/scan.ts`). Both run real scans, so both must enrich identically — the scan agent
 * is in fact the only one that runs on a schedule.
 */
export function createScannerDependencies(config: AppConfig): ScannerDependencies {
  const githubProvider = new GitHubHostingMetricsProvider(new GitHubHttpClient());
  const releaseProvider = new EndOfLifeProvider({ apiUrl: config.releaseBaselineApiUrl });
  return {
    collectHosting: (repository, projects, options) =>
      collectGitHubEnrichment(repository, projects, {
        ...options,
        provider: githubProvider,
        now: () => new Date()
      }),
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
