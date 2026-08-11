import 'server-only';

import { getAge } from './age';
import { eliteClubKeys, getCanonicalClub, knownClubKeys } from './club-canonical';
import { GRID_SIZE } from './club-grid-shared';
import {
  clubHasPlayer,
  getClubCrest,
  getClubLabel,
  getClubMembershipMap,
  playersForBothClubs,
} from './club-membership';
import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import { type DifficultyId } from './difficulty-config';
import { getDb } from './db';
import type { GameModeId } from './game-modes';
import { resolveCanonicalPlayerId } from './player-identity';
import { getLatestClub, type PlayerDisplay } from './players';

export { GRID_SIZE } from './club-grid-shared';

export interface ClubAxis {
  key: string;
  label: string;
  crest: string | null;
}

export interface ClubGridPuzzle {
  rows: ClubAxis[];
  cols: ClubAxis[];
  /** min intersection size used when building */
  minCellPlayers: number;
}

export interface ClubGridGuessResult {
  correct: boolean;
  cellKey: string;
  guess: PlayerDisplay;
  /** Additional open cells filled by the same correct player */
  extraFills?: Array<{ row: number; col: number; cellKey: string }>;
  remainingCells: number;
  won: boolean;
  gameOver: boolean;
}

interface GridSpec {
  rows: string[];
  cols: string[];
}

const MIN_CELL: Record<DifficultyId, number> = {
  easy: 3,
  medium: 3,
  hard: 2,
};

const gridCache = new Map<string, GridSpec[]>();
const pairCountCache = new Map<string, number>();

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pairCount(a: string, b: string): number {
  const key = pairKey(a, b);
  const cached = pairCountCache.get(key);
  if (cached !== undefined) return cached;
  const n = playersForBothClubs(a, b).length;
  pairCountCache.set(key, n);
  return n;
}

function clubPoolForDifficulty(difficulty: DifficultyId): string[] {
  // Warm membership so sizes are real
  const map = getClubMembershipMap();
  const keys =
    difficulty === 'easy'
      ? eliteClubKeys()
      : difficulty === 'medium'
        ? knownClubKeys()
        : knownClubKeys();

  return keys.filter((k) => (map.get(k)?.size ?? 0) >= 20);
}

function isValidGrid(rows: string[], cols: string[], minN: number): boolean {
  for (const r of rows) {
    for (const c of cols) {
      if (pairCount(r, c) < minN) return false;
    }
  }
  return true;
}

function combinations(arr: string[], k: number): string[][] {
  const out: string[][] = [];
  const n = arr.length;
  const idx = Array.from({ length: k }, (_, i) => i);

  const push = (): void => {
    out.push(idx.map((i) => arr[i]));
  };

  if (k === 0 || k > n) return out;
  push();

  while (true) {
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i -= 1;
    if (i < 0) break;
    idx[i] += 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    push();
  }
  return out;
}

function buildValidGrids(difficulty: DifficultyId): GridSpec[] {
  const cacheKey = difficulty;
  const cached = gridCache.get(cacheKey);
  if (cached) return cached;

  const pool = clubPoolForDifficulty(difficulty);
  const minN = MIN_CELL[difficulty];
  const rowCombos = combinations(pool, GRID_SIZE);
  const valid: GridSpec[] = [];

  for (const rows of rowCombos) {
    const rowSet = new Set(rows);
    const colPool = pool.filter((k) => !rowSet.has(k));
    const colCombos = combinations(colPool, GRID_SIZE);
    for (const cols of colCombos) {
      if (isValidGrid(rows, cols, minN)) {
        valid.push({ rows: [...rows], cols: [...cols] });
      }
    }
  }

  // Stable order for daily hashing
  valid.sort((a, b) => {
    const sa = [...a.rows, ...a.cols].join(',');
    const sb = [...b.rows, ...b.cols].join(',');
    return sa.localeCompare(sb);
  });

  gridCache.set(cacheKey, valid);
  return valid;
}

function toAxis(key: string): ClubAxis {
  const def = getCanonicalClub(key);
  return {
    key,
    label: def?.label ?? getClubLabel(key),
    crest: getClubCrest(key),
  };
}

function playerDisplayById(playerId: number, modeId: GameModeId): PlayerDisplay | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, nationality, position, date_of_birth
       FROM players WHERE id = ?`
    )
    .get(playerId) as
    | {
        id: number;
        name: string;
        nationality: string | null;
        position: string | null;
        date_of_birth: string | null;
      }
    | undefined;

  if (!row) return null;
  const club = getLatestClub(playerId, modeId);
  return {
    id: row.id,
    name: row.name,
    nationality: row.nationality?.trim() || 'Bilinmiyor',
    position: row.position?.trim() || 'Bilinmiyor',
    club: club?.name ?? 'Bilinmiyor',
    clubCrest: club?.crest ?? null,
    age: getAge(row.date_of_birth),
  };
}

export function createClubGridPuzzle(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): ClubGridPuzzle {
  void modeId;
  const spec = getTargetGridSpec(difficulty, date, session);

  return {
    rows: spec.rows.map(toAxis),
    cols: spec.cols.map(toAxis),
    minCellPlayers: MIN_CELL[difficulty],
  };
}

export function getTargetGridSpec(
  difficulty: DifficultyId,
  date: string,
  session: number
): GridSpec {
  const stored = getStoredPuzzle<GridSpec>('club-grid', 'general', difficulty, date, session);
  if (stored?.rows?.length && stored?.cols?.length) {
    return stored;
  }

  const grids = buildValidGrids(difficulty);
  if (grids.length === 0) {
    throw new Error('No eligible club grids for this difficulty');
  }
  const index = getDailyIndex(
    date,
    buildPuzzleKey('club-grid', difficulty, session),
    grids.length
  );
  const spec = grids[index];
  savePuzzle('club-grid', 'general', difficulty, date, session, spec);
  return spec;
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function guessClubGridCell(params: {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
  row: number;
  col: number;
  playerId: number;
  /** Already filled player ids (unique constraint) */
  usedPlayerIds: number[];
  /** How many cells already correctly filled (excluding this one) */
  solvedCount: number;
  /** Open cells still playable (client state) */
  openCells?: Array<{ row: number; col: number }>;
}): ClubGridGuessResult {
  const {
    modeId,
    difficulty,
    date,
    session,
    row,
    col,
    playerId,
    usedPlayerIds,
    solvedCount,
    openCells = [],
  } = params;

  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    throw new Error('Invalid cell');
  }

  const spec = getTargetGridSpec(difficulty, date, session);
  const rowClub = spec.rows[row];
  const colClub = spec.cols[col];

  const canonicalId = resolveCanonicalPlayerId(playerId);
  const usedCanonical = new Set(usedPlayerIds.map((id) => resolveCanonicalPlayerId(id)));
  if (usedCanonical.has(canonicalId)) {
    throw new Error('Player already used on this grid');
  }

  const guess = playerDisplayById(canonicalId, modeId);
  if (!guess) {
    throw new Error('Player not found');
  }

  const correct =
    clubHasPlayer(rowClub, canonicalId) && clubHasPlayer(colClub, canonicalId);

  let extraFills: Array<{ row: number; col: number; cellKey: string }> | undefined;
  let fillCount = correct ? 1 : 0;

  if (correct) {
    const filled = new Set<string>([cellKey(row, col)]);
    extraFills = [{ row, col, cellKey: cellKey(row, col) }];

    for (const cell of openCells) {
      if (cell.row === row && cell.col === col) continue;
      const key = cellKey(cell.row, cell.col);
      if (filled.has(key)) continue;
      const rClub = spec.rows[cell.row];
      const cClub = spec.cols[cell.col];
      if (clubHasPlayer(rClub, canonicalId) && clubHasPlayer(cClub, canonicalId)) {
        filled.add(key);
        extraFills.push({ row: cell.row, col: cell.col, cellKey: key });
        fillCount++;
      }
    }
  }

  const nextSolved = solvedCount + fillCount;
  const totalCells = GRID_SIZE * GRID_SIZE;
  const won = nextSolved === totalCells;

  return {
    correct,
    cellKey: cellKey(row, col),
    guess,
    extraFills: correct ? extraFills : undefined,
    remainingCells: Math.max(0, totalCells - nextSolved),
    won,
    gameOver: won,
  };
}

export function revealClubGrid(params: {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
  usedPlayerIds: number[];
}): {
  puzzle: ClubGridPuzzle;
  answers: Array<{ row: number; col: number; player: PlayerDisplay }>;
} {
  const { modeId, difficulty, date, session, usedPlayerIds } = params;
  const spec = getTargetGridSpec(difficulty, date, session);
  const used = new Set(usedPlayerIds.map((id) => resolveCanonicalPlayerId(id)));
  const answers: Array<{ row: number; col: number; player: PlayerDisplay }> = [];

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const candidates = playersForBothClubs(spec.rows[r], spec.cols[c]).filter(
        (id) => !used.has(resolveCanonicalPlayerId(id))
      );
      // Prefer more famous-looking names (shorter? first candidate by id)
      candidates.sort((a, b) => a - b);
      const pick = candidates[0];
      if (pick == null) continue;
      const player = playerDisplayById(pick, modeId);
      if (!player) continue;
      used.add(pick);
      answers.push({ row: r, col: c, player });
    }
  }

  return {
    puzzle: {
      rows: spec.rows.map(toAxis),
      cols: spec.cols.map(toAxis),
      minCellPlayers: MIN_CELL[difficulty],
    },
    answers,
  };
}

/** Expose for diagnostics / tests */
export function debugGridCount(difficulty: DifficultyId): number {
  return buildValidGrids(difficulty).length;
}

export function getCellCandidateCount(
  difficulty: DifficultyId,
  date: string,
  session: number,
  row: number,
  col: number
): number {
  const spec = getTargetGridSpec(difficulty, date, session);
  return playersForBothClubs(spec.rows[row], spec.cols[col]).length;
}
