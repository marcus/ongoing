import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { loadConfig } from '$lib/server/config';
import { createScannerDependencies } from './dependencies';
import { ScanScheduler } from './scheduler';
import { Scanner, ScanInProgressError } from './scanner';

const config = loadConfig();
const database = new CatalogDatabase(config.databasePath);
export const catalogRepository = new CatalogRepository(database);
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
