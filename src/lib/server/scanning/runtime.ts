import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { loadRuntimeConfig } from '$lib/server/config';
import { activeProviderNames } from '$lib/server/providers/registry';
import { createScannerDependencies } from './dependencies';
import { ScanScheduler } from './scheduler';
import { AttachmentService } from '$lib/server/attachments';
import { Scanner, ScanInProgressError } from './scanner';

const config = loadRuntimeConfig();
const database = new CatalogDatabase(config.databasePath);
export const appConfig = config;
// The registry only carries fields from providers that can actually run here, so a rule reading a
// field belonging to a disabled or missing provider finds nothing rather than something wrong.
export const catalogRepository = new CatalogRepository(database, undefined, {
  providers: activeProviderNames(config)
});
export const attachmentService = new AttachmentService(catalogRepository, config.databasePath);
export const catalogScanner = new Scanner(
  catalogRepository,
  config,
  createScannerDependencies(config)
);
export const catalogScanScheduler = new ScanScheduler(catalogScanner);

const enrichmentTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleProjectEnrichment(projectId: string, attemptsRemaining = 12): void {
  if (enrichmentTimers.has(projectId)) return;
  const attempt = async () => {
    enrichmentTimers.delete(projectId);
    const project = catalogRepository.getProject(projectId);
    if (!project || project.isHidden) return;
    try {
      const handle = await catalogScanner.start({ reason: 'project', projectId, refresh: 'full' });
      void handle.completion;
    } catch (error) {
      if (error instanceof ScanInProgressError && attemptsRemaining > 1) {
        const timer = setTimeout(
          () => scheduleProjectEnrichment(projectId, attemptsRemaining - 1),
          5_000
        );
        enrichmentTimers.set(projectId, timer);
      } else console.error(`Unable to enrich restored project ${projectId}`, error);
    }
  };
  const timer = setTimeout(() => void attempt(), 0);
  enrichmentTimers.set(projectId, timer);
}
