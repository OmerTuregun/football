import 'server-only';

import { getAge } from './age';
import { type DifficultyId } from './difficulty';
import { getDb } from './db';
import type { GameModeId } from './game-modes';
import {
  getLatestClub,
  getPlayerPool,
  type PlayerRow,
} from './players';

export type StatCategory = 'age' | 'clubCount' | 'goals' | 'assists' | 'marketValue';
export type HigherLowerGuess = 'higher' | 'lower';

export interface HigherLowerPlayerCard {
  id: number;
  name: string;
  nationality: string;
  position: string;
  club: string;
  clubCrest: string | null;
}

export const STAT_CATEGORIES: {
  id: StatCategory;
  label: string;
  unit: string;
}[] = [
  { id: 'age', label: 'YAŞ', unit: 'yaş' },
  { id: 'clubCount', label: 'KULÜP SAYISI', unit: 'kulüp' },
  { id: 'goals', label: 'GOL', unit: 'gol' },
  { id: 'assists', label: 'ASİST', unit: 'asist' },
  { id: 'marketValue', label: 'PİYASA DEĞERİ', unit: '€' },
];

const ALL_CATEGORIES: StatCategory[] = STAT_CATEGORIES.map((c) => c.id);

export function getCategoryMeta(category: StatCategory) {
  const meta = STAT_CATEGORIES.find((c) => c.id === category);
  if (!meta) throw new Error(`Unknown category: ${category}`);
  return meta;
}

export function isValidStatCategory(value: string): value is StatCategory {
  return ALL_CATEGORIES.includes(value as StatCategory);
}

export function isValidGuess(value: string): value is HigherLowerGuess {
  return value === 'higher' || value === 'lower';
}

export function pickRandomCategory(): StatCategory {
  return ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)];
}

export function getPlayerAge(playerId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT date_of_birth FROM players WHERE id = ?`)
    .get(playerId) as { date_of_birth: string | null } | undefined;
  if (!row) return null;
  return getAge(row.date_of_birth);
}

export function getPlayerClubCount(playerId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT team_id) AS count
       FROM player_season_stats
       WHERE player_id = ?`
    )
    .get(playerId) as { count: number };
  return row?.count ?? 0;
}

/** Career totals across all season/competition rows. */
export function getPlayerCareerGoals(playerId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(goals), 0) AS total, COUNT(*) AS rows
       FROM player_season_stats
       WHERE player_id = ?`
    )
    .get(playerId) as { total: number; rows: number };
  if (!row || row.rows === 0) return null;
  return row.total;
}

export function getPlayerCareerAssists(playerId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(assists), 0) AS total, COUNT(*) AS rows
       FROM player_season_stats
       WHERE player_id = ?`
    )
    .get(playerId) as { total: number; rows: number };
  if (!row || row.rows === 0) return null;
  return row.total;
}

export function getPlayerMarketValue(playerId: number): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT market_value_eur FROM players WHERE id = ? AND market_value_eur IS NOT NULL AND market_value_eur > 0`
    )
    .get(playerId) as { market_value_eur: number } | undefined;
  return row?.market_value_eur ?? null;
}

export function getStatValue(playerId: number, category: StatCategory): number | null {
  switch (category) {
    case 'age':
      return getPlayerAge(playerId);
    case 'clubCount':
      return getPlayerClubCount(playerId);
    case 'goals':
      return getPlayerCareerGoals(playerId);
    case 'assists':
      return getPlayerCareerAssists(playerId);
    case 'marketValue':
      return getPlayerMarketValue(playerId);
    default:
      return null;
  }
}

function normalizeText(value: string | null | undefined, fallback = 'Bilinmiyor'): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function toHigherLowerCard(player: PlayerRow, modeId: GameModeId): HigherLowerPlayerCard {
  const club = getLatestClub(player.id, modeId);
  return {
    id: player.id,
    name: player.name,
    nationality: normalizeText(player.nationality),
    position: normalizeText(player.position),
    club: club?.name ?? 'Bilinmiyor',
    clubCrest: club?.crest ?? null,
  };
}

function playerHasStat(playerId: number, category: StatCategory): boolean {
  const value = getStatValue(playerId, category);
  if (value === null) return false;
  // Club count of 0 is useless for comparison
  if (category === 'clubCount' && value <= 0) return false;
  return true;
}

export function getRandomChallenger(
  modeId: GameModeId,
  difficulty: DifficultyId,
  excludePlayerId?: number,
  category?: StatCategory
): PlayerRow {
  const pool = getPlayerPool(modeId, difficulty).filter((player) => {
    if (excludePlayerId !== undefined && player.id === excludePlayerId) return false;
    if (category && !playerHasStat(player.id, category)) return false;
    return true;
  });

  if (pool.length === 0) {
    throw new Error('No eligible players for higher-lower challenge');
  }

  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

export function createChallenge(
  modeId: GameModeId,
  difficulty: DifficultyId,
  excludePlayerId?: number,
  forcedCategory?: StatCategory,
  /** Category must also be available for this player (e.g. upcoming reference). */
  anchorPlayerId?: number
): { player: HigherLowerPlayerCard; category: StatCategory } {
  const tryCategories = forcedCategory
    ? [forcedCategory]
    : shuffleCategories(
        ALL_CATEGORIES.filter((cat) =>
          anchorPlayerId === undefined ? true : playerHasStat(anchorPlayerId, cat)
        )
      );

  if (tryCategories.length === 0) {
    throw new Error('No eligible players for higher-lower challenge');
  }

  let lastError: Error | null = null;
  for (const category of tryCategories) {
    try {
      const player = getRandomChallenger(modeId, difficulty, excludePlayerId, category);
      return {
        player: toHigherLowerCard(player, modeId),
        category,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('No eligible players for higher-lower challenge');
}

function shuffleCategories(categories: StatCategory[]): StatCategory[] {
  const copy = [...categories];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * higher = challenger value should be greater than reference
 * lower  = challenger value should be less than reference
 * Equal values count as incorrect for both directions.
 */
export function evaluateGuess(
  referenceValue: number,
  challengerValue: number,
  guess: HigherLowerGuess
): boolean {
  if (guess === 'higher') return challengerValue > referenceValue;
  return challengerValue < referenceValue;
}

export function revealChallenge(params: {
  referenceId: number;
  challengerId: number;
  category: StatCategory;
  guess: HigherLowerGuess;
}): {
  referenceValue: number;
  challengerValue: number;
  correct: boolean;
  category: StatCategory;
} {
  const referenceValue = getStatValue(params.referenceId, params.category);
  const challengerValue = getStatValue(params.challengerId, params.category);

  if (referenceValue === null || challengerValue === null) {
    throw new Error('Stat value unavailable for one of the players');
  }

  return {
    referenceValue,
    challengerValue,
    correct: evaluateGuess(referenceValue, challengerValue, params.guess),
    category: params.category,
  };
}

/** Bootstrap: reveal a single player's visible reference stat (never used for hidden card). */
export function revealPlayerStat(
  playerId: number,
  category: StatCategory
): number {
  const value = getStatValue(playerId, category);
  if (value === null) {
    throw new Error('Stat value unavailable');
  }
  return value;
}
