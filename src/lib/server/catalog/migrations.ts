import type { Database } from 'bun:sqlite';
import initialSchema from './migrations/001_initial.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const migrations: readonly Migration[] = [{ version: 1, sql: initialSchema }];

export function migrateDatabase(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = database
    .query<{ version: number }, []>('SELECT version FROM schema_migrations')
    .all();
  const appliedVersions = new Set(applied.map(({ version }) => version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    const apply = database.transaction(() => {
      database.exec(migration.sql);
      database
        .query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    });
    apply.immediate();
  }
}

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
