import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrateDatabase } from './migrations';

export class CatalogDatabase {
  readonly sqlite: Database;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path, { create: true, strict: true });
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    this.sqlite.exec('PRAGMA journal_mode = WAL');
    this.sqlite.exec('PRAGMA busy_timeout = 5000');
    migrateDatabase(this.sqlite);
  }

  async write<T>(operation: (database: Database) => T): Promise<T> {
    let release!: () => void;
    const previous = this.writeTail;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return operation(this.sqlite);
    } finally {
      release();
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
