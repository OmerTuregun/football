/**
 * Pre-generate daily puzzles into SQLite for fast API responses.
 * Run: npm run pregenerate-puzzles (from web/)
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

import { createCareerPuzzle } from '../lib/career-path';
import { createClubGridPuzzle } from '../lib/club-grid';
import { createConnectionsPuzzle } from '../lib/connections';
import { getTodayDateString } from '../lib/daily-hash';
import { DIFFICULTIES } from '../lib/difficulty-config';
import { GAME_MODES } from '../lib/game-modes';
import { createMissingXiPuzzle } from '../lib/missing-xi';
import { createOnlukPuzzle } from '../lib/onluk';
import { ONLUK_DIFFICULTY } from '../lib/onluk-shared';
import { getDailyPlayer, type PuzzleContext } from '../lib/players';

const MISSING_XI_MODES = GAME_MODES.filter(
  (m) => m.id === 'general' || m.id === 'cl' || m.id === 'top5'
);

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const pastDays = parseInt(process.env.PUZZLE_PAST_DAYS ?? '10', 10);
  const horizon = parseInt(process.env.PUZZLE_HORIZON_DAYS ?? '14', 10);
  const today = getTodayDateString();
  let created = 0;
  let errors = 0;

  // DB önbelleği: son 10 gün (bugün dahil) + ekstra ileri günler
  for (let day = -pastDays; day <= horizon; day++) {
    const date = addDays(today, day);
    try {
      createOnlukPuzzle(ONLUK_DIFFICULTY, date, 0);
      created++;
    } catch (e) {
      console.warn('[onluk]', date, e);
      errors++;
    }

    for (const diff of DIFFICULTIES) {
      try {
        createClubGridPuzzle('general', diff.id, date, 0);
        created++;
      } catch (e) {
        console.warn('[club-grid]', date, diff.id, e);
        errors++;
      }

      try {
        createConnectionsPuzzle(diff.id, date, 0);
        created++;
      } catch (e) {
        console.warn('[connections]', date, diff.id, e);
        errors++;
      }

      for (const mode of GAME_MODES) {
        try {
          getDailyPlayer({ modeId: mode.id, difficulty: diff.id, date, session: 0 });
          created++;
        } catch (e) {
          console.warn('[daily-player]', date, mode.id, diff.id, e);
          errors++;
        }

        try {
          createCareerPuzzle(mode.id, diff.id, date, 0);
          created++;
        } catch (e) {
          console.warn('[career-path]', date, mode.id, diff.id, e);
          errors++;
        }
      }

      for (const mode of MISSING_XI_MODES) {
        try {
          createMissingXiPuzzle(mode.id, diff.id, date, 0);
          created++;
        } catch (e) {
          console.warn('[missing-xi]', date, mode.id, diff.id, e);
          errors++;
        }
      }
    }
  }

  console.log(
    `Pregenerate done: ${created} puzzles, ${errors} errors (${today} -${pastDays}d .. +${horizon}d)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
