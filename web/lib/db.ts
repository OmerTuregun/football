import 'server-only';

import Database from 'better-sqlite3';
import path from 'path';

const defaultPath = path.resolve(process.cwd(), '../data-pipeline/data/football.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH ?? defaultPath;
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('foreign_keys = ON');
  }
  return db;
}
