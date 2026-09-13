import type { Database } from 'bun:sqlite';
import initialSchema from './migrations/001_initial.sql?raw';
import scanLeases from './migrations/002_scan_leases.sql?raw';
import stacks from './migrations/003_stacks.sql?raw';
import missingSince from './migrations/004_missing_since.sql?raw';
import website from './migrations/005_website.sql?raw';
import websitePages from './migrations/006_website_pages.sql?raw';
import entries from './migrations/007_entries.sql?raw';
import rekeyMetrics from './migrations/008_rekey_metrics.sql?raw';
import providerRuns from './migrations/009_provider_runs.sql?raw';
import richFields from './migrations/010_rich_fields.sql?raw';
import { migrateProjectsIntoEntries } from './migrations/007_entries';

interface Migration {
  version: number;
  sql: string;
  /**
   * Runs inside the migration's transaction, after its statements. Data moves that need real logic
   * — generating and de-duplicating slugs, say — live here instead of being forced into SQL.
   */
  migrate?: (database: Database) => void;
}

const migrations: readonly Migration[] = [
  { version: 1, sql: initialSchema },
  { version: 2, sql: scanLeases },
  { version: 3, sql: stacks },
  { version: 4, sql: missingSince },
  { version: 5, sql: website },
  { version: 6, sql: websitePages },
  { version: 7, sql: entries, migrate: migrateProjectsIntoEntries },
  { version: 8, sql: rekeyMetrics },
  { version: 9, sql: providerRuns },
  { version: 10, sql: richFields }
];

/**
 * Split a migration into individual statements.
 *
 * `Database.exec()` runs a multi-statement script but **swallows runtime errors and keeps going**:
 * a failing `INSERT … SELECT` would not abort the `DROP TABLE` that follows it, and the surrounding
 * transaction would still commit. Migrations that move data must therefore be run one statement at
 * a time through `run()`, which throws and lets the transaction roll back.
 *
 * Migration SQL may use `--` comments and single-quoted literals; a literal must not contain a
 * semicolon, which no schema statement needs.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let inComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (inComment) {
      if (character === '\n') inComment = false;
      else continue;
    } else if (inString) {
      if (character === "'") inString = false;
    } else if (character === "'") {
      inString = true;
    } else if (character === '-' && sql[index + 1] === '-') {
      inComment = true;
      continue;
    } else if (character === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

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
      for (const statement of splitStatements(migration.sql)) database.run(statement);
      migration.migrate?.(database);
      database
        .query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    });
    apply.immediate();
  }
}

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
