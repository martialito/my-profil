import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env, paths, resolveFromRoot } from '../config/env.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Open a database and apply pending migrations. Use ":memory:" in tests. */
export function createDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as Db;
  migrate(db, { migrationsFolder: paths.migrations() });
  return db;
}

let instance: Db | undefined;

export function getDb(): Db {
  if (!instance) instance = createDb(resolveFromRoot(env().DATABASE_URL));
  return instance;
}

export function closeDb(): void {
  instance?.$client.close();
  instance = undefined;
}

export { schema };
