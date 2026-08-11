import 'server-only';

import { getAge } from './age';
import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import { type DifficultyId } from './difficulty';
import { getDb } from './db';
import { MAX_GUESSES, type GameModeId } from './game-modes';
import {
  getLatestClub,
  getPlayerById,
  getPlayerPool,
  type PlayerDisplay,
  type PlayerRow,
} from './players';

export interface ClubStop {
  teamId: number | null;
  name: string;
  crest: string | null;
}

export interface CareerPathPuzzle {
  clubs: ClubStop[];
  clubCount: number;
}

export interface CareerPathGuessResult {
  guess: PlayerDisplay;
  correct: boolean;
  won: boolean;
  gameOver: boolean;
  remainingGuesses: number;
  revealed?: PlayerDisplay;
  path?: CareerPathPuzzle;
}

const MIN_CLUBS_BY_DIFFICULTY: Record<DifficultyId, number> = {
  easy: 3,
  medium: 4,
  hard: 5,
};

type EligibleEntry = { player: PlayerRow; path: ClubStop[] };
const eligibleCache = new Map<string, EligibleEntry[]>();

function normalizeText(value: string | null | undefined, fallback = 'Bilinmiyor'): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function toDisplay(player: PlayerRow, modeId: GameModeId): PlayerDisplay {
  const club = getLatestClub(player.id, modeId);
  return {
    id: player.id,
    name: player.name,
    nationality: normalizeText(player.nationality),
    position: normalizeText(player.position),
    club: club?.name ?? 'Bilinmiyor',
    clubCrest: club?.crest ?? null,
    age: getAge(player.date_of_birth),
  };
}

function resolveTeam(
  teamId: number | null | undefined,
  fallbackName: string | null | undefined
): ClubStop | null {
  const db = getDb();
  if (teamId) {
    const row = db
      .prepare(`SELECT id, name, crest FROM teams WHERE id = ?`)
      .get(teamId) as { id: number; name: string; crest: string | null } | undefined;
    if (row) {
      return { teamId: row.id, name: row.name, crest: row.crest };
    }
  }
  const name = fallbackName?.trim();
  if (!name) return null;
  return { teamId: teamId ?? null, name, crest: null };
}

/** Build chronological club path from transfers, falling back to season stats. */
export function getCareerPath(playerId: number): ClubStop[] {
  const db = getDb();
  const transfers = db
    .prepare(
      `SELECT transfer_date, from_team_id, to_team_id, from_team_name, to_team_name
       FROM transfers
       WHERE player_id = ?
       ORDER BY
         CASE WHEN transfer_date IS NULL OR transfer_date = '' THEN 1 ELSE 0 END,
         transfer_date ASC,
         id ASC`
    )
    .all(playerId) as Array<{
    transfer_date: string | null;
    from_team_id: number | null;
    to_team_id: number | null;
    from_team_name: string | null;
    to_team_name: string | null;
  }>;

  const path: ClubStop[] = [];
  const pushUnique = (stop: ClubStop | null): void => {
    if (!stop) return;
    const last = path[path.length - 1];
    if (last) {
      if (last.teamId !== null && stop.teamId !== null && last.teamId === stop.teamId) return;
      if (last.teamId === null && stop.teamId === null && last.name === stop.name) return;
    }
    path.push(stop);
  };

  if (transfers.length > 0) {
    const first = transfers[0];
    pushUnique(resolveTeam(first.from_team_id, first.from_team_name));
    for (const tr of transfers) {
      pushUnique(resolveTeam(tr.to_team_id, tr.to_team_name));
    }
  }

  if (path.length >= 3) return path;

  const seasons = db
    .prepare(
      `SELECT t.id AS team_id, t.name AS team_name, t.crest, MIN(s.season_year) AS first_year
       FROM player_season_stats pss
       JOIN teams t ON t.id = pss.team_id
       JOIN seasons s ON s.id = pss.season_id
       WHERE pss.player_id = ?
       GROUP BY t.id, t.name, t.crest
       ORDER BY first_year ASC, t.name ASC`
    )
    .all(playerId) as Array<{
    team_id: number;
    team_name: string;
    crest: string | null;
    first_year: number;
  }>;

  for (const row of seasons) {
    pushUnique({
      teamId: row.team_id,
      name: row.team_name,
      crest: row.crest,
    });
  }

  return path;
}

function minClubsFor(difficulty: DifficultyId): number {
  return MIN_CLUBS_BY_DIFFICULTY[difficulty] ?? 3;
}

function eligibleCareerPool(
  modeId: GameModeId,
  difficulty: DifficultyId
): EligibleEntry[] {
  const key = `${modeId}:${difficulty}`;
  const cached = eligibleCache.get(key);
  if (cached) return cached;

  const minClubs = minClubsFor(difficulty);
  const pool = getPlayerPool(modeId, difficulty);
  const out: EligibleEntry[] = [];

  for (const player of pool) {
    const path = getCareerPath(player.id);
    if (path.length >= minClubs) {
      out.push({ player, path });
    }
  }

  eligibleCache.set(key, out);
  return out;
}

export function getTargetCareerPlayer(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): EligibleEntry {
  const stored = getStoredPuzzle<{ playerId: number }>(
    'career-path',
    modeId,
    difficulty,
    date,
    session
  );
  if (stored?.playerId) {
    const eligible = eligibleCareerPool(modeId, difficulty);
    const hit = eligible.find((e) => e.player.id === stored.playerId);
    if (hit) return hit;
  }

  const eligible = eligibleCareerPool(modeId, difficulty);
  if (eligible.length === 0) {
    throw new Error('No eligible players for career path');
  }
  const index = getDailyIndex(date, buildPuzzleKey(modeId, difficulty, session), eligible.length);
  const entry = eligible[index];
  savePuzzle('career-path', modeId, difficulty, date, session, { playerId: entry.player.id });
  return entry;
}

export function createCareerPuzzle(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): CareerPathPuzzle {
  const { path } = getTargetCareerPlayer(modeId, difficulty, date, session);
  return {
    clubs: path.map((c) => ({
      teamId: c.teamId,
      name: c.name,
      crest: c.crest,
    })),
    clubCount: path.length,
  };
}

export function guessCareerPath(params: {
  playerId: number;
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
  attemptNumber: number;
}): CareerPathGuessResult {
  const { playerId, modeId, difficulty, date, session, attemptNumber } = params;

  if (attemptNumber < 1 || attemptNumber > MAX_GUESSES) {
    throw new Error('Invalid attempt number');
  }

  const guessPlayer = getPlayerById(playerId, modeId);
  if (!guessPlayer) {
    throw new Error('Player not in mode pool');
  }

  const target = getTargetCareerPlayer(modeId, difficulty, date, session);
  const correct = guessPlayer.id === target.player.id;
  const gameOver = correct || attemptNumber >= MAX_GUESSES;
  const remainingGuesses = Math.max(0, MAX_GUESSES - attemptNumber);

  const result: CareerPathGuessResult = {
    guess: toDisplay(guessPlayer, modeId),
    correct,
    won: correct,
    gameOver,
    remainingGuesses,
  };

  if (gameOver) {
    result.revealed = toDisplay(target.player, modeId);
    result.path = {
      clubs: target.path,
      clubCount: target.path.length,
    };
  }

  return result;
}

export function revealCareerPath(params: {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
}): { revealed: PlayerDisplay; path: CareerPathPuzzle } {
  const target = getTargetCareerPlayer(
    params.modeId,
    params.difficulty,
    params.date,
    params.session
  );
  return {
    revealed: toDisplay(target.player, params.modeId),
    path: {
      clubs: target.path,
      clubCount: target.path.length,
    },
  };
}
