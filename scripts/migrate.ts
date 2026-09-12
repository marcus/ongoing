import { CatalogDatabase } from '../src/lib/server/catalog/database';
import { loadRuntimeConfig } from '../src/lib/server/config';

const config = loadRuntimeConfig();
const database = new CatalogDatabase(config.databasePath);
database.close();
console.log('Database migrations are current.');
