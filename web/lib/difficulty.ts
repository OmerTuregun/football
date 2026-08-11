import 'server-only';

import { getDb } from './db';
import type { DifficultyId } from './difficulty-config';
import { INTERNATIONAL_COMPETITION_CODES } from './game-modes';

export type { DifficultyId } from './difficulty-config';
export { DIFFICULTIES, isValidDifficulty } from './difficulty-config';

export type FameTier = 'elite' | 'known' | 'obscure';

const TOP_LEAGUE_CODES = new Set(['PL', 'BL1', 'PD', 'SA', 'FL1', 'CL']);

/** Kolay: gerçekten herkesin bildiği kulüpler */
const ELITE_CLUB_TLAS = new Set([
  'MCI',
  'ARS',
  'LIV',
  'CHE',
  'MUN',
  'RMA',
  'BAR',
  'ATM',
  'BAY',
  'JUV',
  'MIL',
  'INT',
  'NAP',
  'PSG',
]);

/** Orta: bilinen ama her maç izlenmeyen kulüpler */
const KNOWN_CLUB_TLAS = new Set([
  'TOT',
  'NEW',
  'DOR',
  'RBL',
  'BEN',
  'POR',
  'AJA',
  'PSV',
  'SEV',
  'VIL',
  'ROM',
  'LAZ',
  'ATA',
  'WOL',
  'LEV',
  'MON',
  'MAR',
  'LYO',
  'CEL',
  'RSO',
]);

let fameTierCache: Map<number, FameTier> | null = null;

function buildFameTierCache(): Map<number, FameTier> {
  const db = getDb();
  const intlPlaceholders = INTERNATIONAL_COMPETITION_CODES.map(() => '?').join(',');

  const rows = db
    .prepare(
      `SELECT p.id AS player_id, t.tla, c.code
       FROM players p
       JOIN player_season_stats pss ON p.id = pss.player_id
       JOIN teams t ON t.id = pss.team_id
       JOIN competitions c ON c.id = pss.competition_id
       WHERE c.code NOT IN (${intlPlaceholders})`
    )
    .all(...INTERNATIONAL_COMPETITION_CODES) as {
    player_id: number;
    tla: string | null;
    code: string;
  }[];

  const info = new Map<
    number,
    { eliteClub: boolean; knownClub: boolean; topLeague: boolean }
  >();

  for (const row of rows) {
    const current = info.get(row.player_id) ?? {
      eliteClub: false,
      knownClub: false,
      topLeague: false,
    };

    if (row.tla && ELITE_CLUB_TLAS.has(row.tla)) current.eliteClub = true;
    if (row.tla && KNOWN_CLUB_TLAS.has(row.tla)) current.knownClub = true;
    if (TOP_LEAGUE_CODES.has(row.code)) current.topLeague = true;

    info.set(row.player_id, current);
  }

  const tiers = new Map<number, FameTier>();

  for (const [playerId, flags] of info) {
    if (flags.eliteClub) {
      tiers.set(playerId, 'elite');
    } else if (flags.knownClub || flags.topLeague) {
      tiers.set(playerId, 'known');
    } else {
      tiers.set(playerId, 'obscure');
    }
  }

  return tiers;
}

export function getFameTier(playerId: number): FameTier {
  if (!fameTierCache) fameTierCache = buildFameTierCache();
  return fameTierCache.get(playerId) ?? 'obscure';
}

export function playerMatchesDifficulty(
  playerId: number,
  difficulty: DifficultyId
): boolean {
  if (difficulty === 'hard') return true;
  const tier = getFameTier(playerId);
  if (difficulty === 'easy') return tier === 'elite';
  return tier === 'elite' || tier === 'known';
}

export function filterPoolByDifficulty<T extends { id: number }>(
  players: T[],
  difficulty: DifficultyId
): T[] {
  if (difficulty === 'hard') return players;
  return players.filter((player) => playerMatchesDifficulty(player.id, difficulty));
}
