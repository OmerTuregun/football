/**
 * Clear all cached daily puzzles and regenerate from current DB.
 * Run: npm run regenerate-puzzles (from web/)
 */

// Stub server-only so puzzle libs can load under ts-node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeModule = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, parent, isMain);
};

import Database from 'better-sqlite3';
import path from 'path';

import { createCareerPuzzle } from '../lib/career-path';
import { createClubGridPuzzle } from '../lib/club-grid';
import { createConnectionsPuzzle } from '../lib/connections';
import { getTodayDateString } from '../lib/daily-hash';
import { DIFFICULTIES } from '../lib/difficulty-config';
import { GAME_MODES } from '../lib/game-modes';
import { createMissingXiPuzzle } from '../lib/missing-xi';
import { createOnlukPuzzle } from '../lib/onluk';
import { ONLUK_DIFFICULTY } from '../lib/onluk-shared';
import { getDailyPlayer } from '../lib/players';

const MISSING_XI_MODES = GAME_MODES.filter(
  (m) => m.id === 'general' || m.id === 'cl' || m.id === 'top5'
);

const defaultPath = path.resolve(process.cwd(), '../data-pipeline/data/football.db');

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clearPuzzleCache(): number {
  const dbPath = process.env.DB_PATH ?? defaultPath;
  const db = new Database(dbPath);
  db.exec(`
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
  `);
  const before = (
    db.prepare('SELECT COUNT(*) AS n FROM daily_puzzles').get() as { n: number }
  ).n;
  db.prepare('DELETE FROM daily_puzzles').run();
  db.close();
  return before;
}

async function main(): Promise<void> {
  const pastDays = parseInt(process.env.PUZZLE_PAST_DAYS ?? '10', 10);
  const horizon = parseInt(process.env.PUZZLE_HORIZON_DAYS ?? '14', 10);
  const today = getTodayDateString();

  const removed = clearPuzzleCache();
  console.log(`Cleared ${removed} cached puzzle(s) from daily_puzzles`);

  let created = 0;
  let errors = 0;
  const errorSamples: string[] = [];

  for (let day = -pastDays; day <= horizon; day++) {
    const date = addDays(today, day);

    try {
      process.stdout.write(`  ${date} onluk...`);
      createOnlukPuzzle(ONLUK_DIFFICULTY, date, 0);
      created++;
      console.log(' ok');
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      if (errorSamples.length < 8) errorSamples.push(`${date} onluk: ${msg}`);
      console.log(` fail: ${msg}`);
    }

    for (const diff of DIFFICULTIES) {
      const tries: Array<{ label: string; fn: () => void }> = [
        { label: 'club-grid', fn: () => createClubGridPuzzle('general', diff.id, date, 0) },
        { label: 'connections', fn: () => createConnectionsPuzzle(diff.id, date, 0) },
        ...GAME_MODES.flatMap((mode) => [
          {
            label: `daily-player/${mode.id}`,
            fn: () => {
              getDailyPlayer({ modeId: mode.id, difficulty: diff.id, date, session: 0 });
            },
          },
          {
            label: `career-path/${mode.id}`,
            fn: () => createCareerPuzzle(mode.id, diff.id, date, 0),
          },
        ]),
        ...MISSING_XI_MODES.map((mode) => ({
          label: `missing-xi/${mode.id}`,
          fn: () => createMissingXiPuzzle(mode.id, diff.id, date, 0),
        })),
      ];

      for (const t of tries) {
        try {
          process.stdout.write(`  ${date} ${diff.id} ${t.label}...`);
          t.fn();
          created++;
          console.log(' ok');
        } catch (e) {
          errors++;
          const msg = `[${t.label}] ${date} ${diff.id}: ${e instanceof Error ? e.message : e}`;
          console.log(' FAIL');
          if (errorSamples.length < 20) errorSamples.push(msg);
          console.warn(msg);
        }
      }
    }
  }

  const dbPath = process.env.DB_PATH ?? defaultPath;
  const db = new Database(dbPath, { readonly: true });
  const counts = db
    .prepare(
      `SELECT game_id, mode_id, COUNT(*) AS n
       FROM daily_puzzles
       GROUP BY game_id, mode_id
       ORDER BY game_id, mode_id`
    )
    .all() as Array<{ game_id: string; mode_id: string; n: number }>;
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM daily_puzzles').get() as { n: number }
  ).n;
  db.close();

  console.log(`\nRegenerate done: ${created} created, ${errors} errors (${today} -${pastDays}d .. +${horizon}d)`);
  console.log(`daily_puzzles total: ${total}`);
  for (const row of counts) {
    console.log(`  ${row.game_id} / ${row.mode_id}: ${row.n}`);
  }
  if (errorSamples.length > 0) {
    console.log('\nSample errors:');
    for (const s of errorSamples) console.log(' ', s);
  }
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
