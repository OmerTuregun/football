import 'server-only';

import Database from 'better-sqlite3';
import path from 'path';

import type { DifficultyId } from './difficulty-config';

export type DailyPuzzleGameId =
  | 'daily-player'
  | 'missing-xi'
  | 'career-path'
  | 'club-grid'
  | 'onluk'
  | 'connections';

const defaultPath = path.resolve(process.cwd(), '../data-pipeline/data/football.db');

let writableDb: Database.Database | null = null;
let tableReady = false;

function getWritableDb(): Database.Database {
  if (!writableDb) {
    const dbPath = process.env.DB_PATH ?? defaultPath;
    writableDb = new Database(dbPath, { fileMustExist: true });
    writableDb.pragma('foreign_keys = ON');
  }
  if (!tableReady) {
    writableDb.exec(`
      CREATE TABLE IF NOT EXISTS daily_puzzles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id      TEXT NOT NULL,
        mode_id      TEXT NOT NULL DEFAULT 'general',
        difficulty   TEXT NOT NULL,
        puzzle_date  TEXT NOT NULL,
        session      INTEGER NOT NULL DEFAULT 0,
        puzzle_json  TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(game_id, mode_id, difficulty, puzzle_date, session)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_puzzles_lookup
        ON daily_puzzles(game_id, puzzle_date, difficulty, mode_id);
    `);
    tableReady = true;
  }
  return writableDb;
}

export function getStoredPuzzle<T>(
  gameId: DailyPuzzleGameId,
  modeId: string,
  difficulty: DifficultyId,
  puzzleDate: string,
  session: number
): T | null {
  try {
    const db = getWritableDb();
    const row = db
      .prepare(
        `SELECT puzzle_json FROM daily_puzzles
         WHERE game_id = ? AND mode_id = ? AND difficulty = ? AND puzzle_date = ? AND session = ?`
      )
      .get(gameId, modeId, difficulty, puzzleDate, session) as { puzzle_json: string } | undefined;
    if (!row?.puzzle_json) return null;
    return JSON.parse(row.puzzle_json) as T;
  } catch {
    return null;
  }
}

export function savePuzzle(
  gameId: DailyPuzzleGameId,
  modeId: string,
  difficulty: DifficultyId,
  puzzleDate: string,
  session: number,
  payload: unknown
): void {
  try {
    const db = getWritableDb();
    db.prepare(
      `INSERT INTO daily_puzzles (game_id, mode_id, difficulty, puzzle_date, session, puzzle_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, mode_id, difficulty, puzzle_date, session)
       DO UPDATE SET puzzle_json = excluded.puzzle_json`
    ).run(gameId, modeId, difficulty, puzzleDate, session, JSON.stringify(payload));
  } catch (err) {
    console.warn('[daily-puzzles] save failed:', err);
  }
}
