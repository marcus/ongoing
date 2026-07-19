import { CatalogDatabase } from '../src/lib/server/catalog/database';
import { loadConfig } from '../src/lib/server/config';

const config = loadConfig();
const database = new CatalogDatabase(config.databasePath);
database.close();
console.log('Database migrations are current.');
