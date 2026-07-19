import { CatalogDatabase } from '$lib/server/catalog/database';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { loadConfig } from '$lib/server/config';
import { ScanScheduler } from './scheduler';
import { Scanner } from './scanner';

const config = loadConfig();
const database = new CatalogDatabase(config.databasePath);
export const catalogRepository = new CatalogRepository(database);
export const catalogScanner = new Scanner(catalogRepository, config);
export const catalogScanScheduler = new ScanScheduler(catalogScanner);
