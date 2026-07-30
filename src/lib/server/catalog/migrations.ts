import type { Database } from 'bun:sqlite';
import initialSchema from './migrations/001_initial.sql?raw';
import scanLeases from './migrations/002_scan_leases.sql?raw';
import stacks from './migrations/003_stacks.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const migrations: readonly Migration[] = [
  { version: 1, sql: initialSchema },
  { version: 2, sql: scanLeases },
  { version: 3, sql: stacks }
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
      database
        .query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    });
    apply.immediate();
  }
}

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
