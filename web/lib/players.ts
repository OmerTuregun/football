import 'server-only';

import { getAge } from './age';
import { canonicalClubKey } from './club-canonical';
import { getClubCrest } from './club-membership';
import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import { filterPoolByDifficulty, type DifficultyId } from './difficulty';
import { getDb } from './db';
import { resolveLeagueEmblem, resolveNationalityFlag, resolveTeamCrest } from './football-assets';
import { getGameMode, MAX_GUESSES, INTERNATIONAL_COMPETITION_CODES, NON_DOMESTIC_LEAGUE_CODES, type GameModeId } from './game-modes';
import { normalizeForSearch } from './normalize-search';
import { resolveCanonicalPlayerId, getPlayerIdentityCluster } from './player-identity';

export interface PlayerRow {
  id: number;
  name: string;
  nationality: string | null;
  position: string | null;
  date_of_birth: string | null;
}

export interface PlayerDisplay {
  id: number;
  name: string;
  nationality: string;
  nationalityFlag: string | null;
  position: string;
  league: string;
  leagueCode: string;
  leagueEmblem: string | null;
  club: string;
  clubCrest: string | null;
  age: number | null;
  shirtNumber: number | null;
}

export type MatchStatus = 'match' | 'miss';
export type AgeCompareStatus = 'match' | 'older' | 'younger' | 'unknown';
export type NumberCompareStatus = AgeCompareStatus;

export interface ComparisonResult {
  nationality: MatchStatus;
  league: MatchStatus;
  position: MatchStatus;
  club: MatchStatus;
  age: AgeCompareStatus;
  shirtNumber: NumberCompareStatus;
}

export interface GuessResponse {
  guess: PlayerDisplay;
  comparison: ComparisonResult;
  won: boolean;
  gameOver: boolean;
  revealed?: PlayerDisplay;
}

export interface PuzzleContext {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
}

function normalizeText(value: string | null | undefined, fallback = 'Bilinmiyor'): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function compareText(a: string | null | undefined, b: string | null | undefined): MatchStatus {
  const left = a?.trim().toLowerCase() ?? '';
  const right = b?.trim().toLowerCase() ?? '';
  if (!left || !right) return 'miss';
  return left === right ? 'match' : 'miss';
}

function compareAge(
  guessAge: number | null,
  targetAge: number | null
): AgeCompareStatus {
  if (guessAge === null || targetAge === null) return 'unknown';
  if (guessAge === targetAge) return 'match';
  return guessAge < targetAge ? 'older' : 'younger';
}

function compareNumber(
  guessValue: number | null,
  targetValue: number | null
): NumberCompareStatus {
  if (guessValue === null || targetValue === null) return 'unknown';
  if (guessValue === targetValue) return 'match';
  return guessValue < targetValue ? 'older' : 'younger';
}

type LeagueRef = {
  id: number;
  name: string;
  code: string;
  emblem: string | null;
};

let nationalityFlagCache: Map<string, string> | null = null;
const latestLeagueCache = new Map<number, LeagueRef | null>();
const latestShirtCache = new Map<number, number | null>();

const NATIONALITY_FLAG_ALIASES: Record<string, string> = {
  england: 'England',
  scotland: 'Scotland',
  wales: 'Wales',
  'united states': 'United States',
  usa: 'United States',
  'south korea': 'Korea Republic',
  korea: 'Korea Republic',
  'côte d\'ivoire': 'Cote d\'Ivoire',
  'cote d\'ivoire': 'Cote d\'Ivoire',
};

function nationalityFlagLookup(): Map<string, string> {
  if (nationalityFlagCache) return nationalityFlagCache;
  const map = new Map<string, string>();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT area_name, area_flag FROM teams
       WHERE area_name IS NOT NULL AND trim(area_name) != ''
         AND area_flag IS NOT NULL AND trim(area_flag) != ''
       ORDER BY id ASC`
    )
    .all() as Array<{ area_name: string; area_flag: string }>;
  for (const row of rows) {
    const key = row.area_name.trim().toLocaleLowerCase('en-US');
    if (!map.has(key)) map.set(key, row.area_flag);
  }
  const competitionAreas = db
    .prepare(
      `SELECT area_name, area_flag FROM competitions
       WHERE area_name IS NOT NULL AND trim(area_name) != ''
         AND area_flag IS NOT NULL AND trim(area_flag) != ''`
    )
    .all() as Array<{ area_name: string; area_flag: string }>;
  for (const row of competitionAreas) {
    const key = row.area_name.trim().toLocaleLowerCase('en-US');
    if (!map.has(key)) map.set(key, row.area_flag);
  }
  nationalityFlagCache = map;
  return map;
}

export function getNationalityFlag(nationality: string): string | null {
  const normalized = normalizeText(nationality);
  if (normalized === 'Bilinmiyor') return null;
  const lookup = nationalityFlagLookup();
  const direct = lookup.get(normalized.toLocaleLowerCase('en-US'));
  if (direct) return resolveNationalityFlag(normalized, direct);
  const alias = NATIONALITY_FLAG_ALIASES[normalized.toLocaleLowerCase('en-US')];
  if (alias) {
    const fromAlias = lookup.get(alias.toLocaleLowerCase('en-US'));
    return resolveNationalityFlag(normalized, fromAlias);
  }
  return resolveNationalityFlag(normalized, null);
}

export function getLatestLeague(playerId: number, modeId: GameModeId): LeagueRef | null {
  void modeId;
  const cacheKey = resolveCanonicalPlayerId(playerId);
  if (latestLeagueCache.has(cacheKey)) {
    return latestLeagueCache.get(cacheKey) ?? null;
  }

  const db = getDb();
  const excludedCodes = NON_DOMESTIC_LEAGUE_CODES;
  const excludedPlaceholders = excludedCodes.map(() => '?').join(',');
  const cluster = getPlayerIdentityCluster(playerId);
  const placeholders = cluster.map(() => '?').join(',');

  const row = db
    .prepare(
      `SELECT c.id, c.name, c.code, c.emblem,
              COALESCE(
                s.start_date,
                CASE WHEN s.season_year IS NOT NULL THEN printf('%04d-07-01', s.season_year) ELSE '' END,
                ''
              ) AS sortKey
       FROM player_season_stats pss
       JOIN seasons s ON s.id = pss.season_id
       JOIN competitions c ON c.id = pss.competition_id
       WHERE pss.player_id IN (${placeholders})
         AND c.code NOT IN (${excludedPlaceholders})
         AND c.name IS NOT NULL AND trim(c.name) != ''
       ORDER BY
         sortKey DESC,
         COALESCE(s.season_year, 0) DESC,
         COALESCE(pss.appearances, 0) DESC
       LIMIT 1`
    )
    .get(...cluster, ...excludedCodes) as
    | (LeagueRef & { sortKey: string })
    | undefined;

  const result = row
    ? {
        id: row.id,
        name: row.name,
        code: row.code?.trim() || row.name,
        emblem: resolveLeagueEmblem(row.code, row.emblem),
      }
    : null;
  latestLeagueCache.set(cacheKey, result);
  return result;
}

export function getLatestShirtNumber(playerId: number, modeId: GameModeId): number | null {
  const cacheKey = resolveCanonicalPlayerId(playerId);
  if (latestShirtCache.has(cacheKey)) {
    return latestShirtCache.get(cacheKey) ?? null;
  }

  const db = getDb();
  const cluster = getPlayerIdentityCluster(playerId);
  const placeholders = cluster.map(() => '?').join(',');
  const club = getLatestClub(playerId, modeId);

  if (club?.id) {
    const fromCurrentClub = db
      .prepare(
        `SELECT ml.shirt_number,
                COALESCE(m.utc_date, '') AS sortKey
         FROM match_lineups ml
         JOIN matches m ON m.id = ml.match_id
         WHERE ml.player_id IN (${placeholders})
           AND ml.team_id = ?
           AND ml.shirt_number IS NOT NULL
         ORDER BY sortKey DESC, ml.id DESC
         LIMIT 1`
      )
      .get(...cluster, club.id) as { shirt_number: number } | undefined;

    if (fromCurrentClub?.shirt_number != null) {
      latestShirtCache.set(cacheKey, fromCurrentClub.shirt_number);
      return fromCurrentClub.shirt_number;
    }
  }

  const fromLineup = db
    .prepare(
      `SELECT ml.shirt_number,
              COALESCE(m.utc_date, '') AS sortKey
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       WHERE ml.player_id IN (${placeholders})
         AND ml.shirt_number IS NOT NULL
       ORDER BY sortKey DESC, ml.id DESC
       LIMIT 1`
    )
    .get(...cluster) as { shirt_number: number } | undefined;

  if (fromLineup?.shirt_number != null) {
    latestShirtCache.set(cacheKey, fromLineup.shirt_number);
    return fromLineup.shirt_number;
  }

  const fromStats = db
    .prepare(
      `SELECT pss.shirt_number,
              COALESCE(
                s.start_date,
                CASE WHEN s.season_year IS NOT NULL THEN printf('%04d-07-01', s.season_year) ELSE '' END,
                ''
              ) AS sortKey
       FROM player_season_stats pss
       JOIN seasons s ON s.id = pss.season_id
       WHERE pss.player_id IN (${placeholders})
         AND pss.shirt_number IS NOT NULL
       ORDER BY sortKey DESC, pss.id DESC
       LIMIT 1`
    )
    .get(...cluster) as { shirt_number: number } | undefined;

  const result = fromStats?.shirt_number ?? null;
  latestShirtCache.set(cacheKey, result);
  return result;
}

function toPlayerDisplay(
  player: PlayerRow,
  club: { id: number; name: string; crest: string | null } | null,
  league: LeagueRef | null,
  shirtNumber: number | null
): PlayerDisplay {
  const nationality = normalizeText(player.nationality);
  return {
    id: player.id,
    name: player.name,
    nationality,
    nationalityFlag: getNationalityFlag(nationality),
    position: normalizeText(player.position),
    league: league?.name ?? 'Bilinmiyor',
    leagueCode: league?.code ?? '?',
    leagueEmblem: league?.emblem ?? null,
    club: club?.name ?? 'Bilinmiyor',
    clubCrest: club?.crest ?? null,
    age: getAge(player.date_of_birth),
    shirtNumber,
  };
}

function getBasePlayerPool(modeId: GameModeId): PlayerRow[] {
  const mode = getGameMode(modeId);
  const db = getDb();

  if (!mode.competitionIds) {
    return db
      .prepare(
        `SELECT id, name, nationality, position, date_of_birth
         FROM players
         ORDER BY id`
      )
      .all() as PlayerRow[];
  }

  const placeholders = mode.competitionIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT DISTINCT p.id, p.name, p.nationality, p.position, p.date_of_birth
       FROM players p
       INNER JOIN player_season_stats pss ON pss.player_id = p.id
       WHERE pss.competition_id IN (${placeholders})
       ORDER BY p.id`
    )
    .all(...mode.competitionIds) as PlayerRow[];
}

export function getModePlayerPool(modeId: GameModeId): PlayerRow[] {
  return getBasePlayerPool(modeId);
}

export function getPlayerPool(modeId: GameModeId, difficulty: DifficultyId): PlayerRow[] {
  return filterPoolByDifficulty(getBasePlayerPool(modeId), difficulty);
}

export function searchPlayers(
  query: string,
  modeId: GameModeId,
  limit = 10
): PlayerDisplay[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const normalizedQuery = normalizeForSearch(q);
  if (normalizedQuery.length < 2) return [];

  const db = getDb();
  const mode = getGameMode(modeId);
  const like = `%${normalizedQuery}%`;
  const prefix = `${normalizedQuery}%`;
  const tokenLike = `% ${normalizedQuery}%`;

  // Tight SQL ranking: exact → prefix → token → contains. Small LIMIT for speed.
  let candidates: PlayerRow[];
  if (!mode.competitionIds) {
    candidates = db
      .prepare(
        `SELECT id, name, nationality, position, date_of_birth
         FROM players
         WHERE COALESCE(name_search, lower(name)) LIKE ?
         ORDER BY
           CASE
             WHEN COALESCE(name_search, lower(name)) = ? THEN 0
             WHEN COALESCE(name_search, lower(name)) LIKE ? THEN 1
             WHEN COALESCE(name_search, lower(name)) LIKE ? THEN 2
             ELSE 3
           END,
           length(COALESCE(name_search, name)),
           name COLLATE NOCASE
         LIMIT 24`
      )
      .all(like, normalizedQuery, prefix, tokenLike) as PlayerRow[];
  } else {
    const placeholders = mode.competitionIds.map(() => '?').join(',');
    candidates = db
      .prepare(
        `SELECT DISTINCT p.id, p.name, p.nationality, p.position, p.date_of_birth
         FROM players p
         INNER JOIN player_season_stats pss ON pss.player_id = p.id
         WHERE pss.competition_id IN (${placeholders})
           AND COALESCE(p.name_search, lower(p.name)) LIKE ?
         ORDER BY
           CASE
             WHEN COALESCE(p.name_search, lower(p.name)) = ? THEN 0
             WHEN COALESCE(p.name_search, lower(p.name)) LIKE ? THEN 1
             WHEN COALESCE(p.name_search, lower(p.name)) LIKE ? THEN 2
             ELSE 3
           END,
           length(COALESCE(p.name_search, p.name)),
           p.name COLLATE NOCASE
         LIMIT 24`
      )
      .all(...mode.competitionIds, like, normalizedQuery, prefix, tokenLike) as PlayerRow[];
  }

  const byCanonical = new Map<number, { row: PlayerRow; rank: number }>();
  for (const row of candidates) {
    const ns = normalizeForSearch(row.name);
    if (!ns.includes(normalizedQuery)) continue;

    let rank = 3;
    if (ns === normalizedQuery) rank = 0;
    else if (ns.startsWith(`${normalizedQuery} `) || ns.startsWith(normalizedQuery)) rank = 1;
    else if (ns.split(/\s+/).some((part) => part === normalizedQuery)) rank = 1;
    else if (ns.split(/\s+/).some((part) => part.startsWith(normalizedQuery))) rank = 2;

    const canonicalId = resolveCanonicalPlayerId(row.id);
    const existing = byCanonical.get(canonicalId);
    if (existing && existing.rank <= rank) continue;
    byCanonical.set(canonicalId, {
      row: getPlayerRowById(canonicalId) ?? { ...row, id: canonicalId },
      rank,
    });
  }

  const ranked = [...byCanonical.values()].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.row.name.localeCompare(b.row.name, 'tr');
  });

  // Club lookup only for the few results we return (biggest latency win)
  return ranked.slice(0, limit).map(({ row }) => {
    const canonicalId = resolveCanonicalPlayerId(row.id);
    const club = getLatestClub(canonicalId, modeId);
    const league = getLatestLeague(canonicalId, modeId);
    const shirtNumber = getLatestShirtNumber(canonicalId, modeId);
    return toPlayerDisplay(row, club, league, shirtNumber);
  });
}

function getPlayerRowById(playerId: number): PlayerRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, nationality, position, date_of_birth
       FROM players WHERE id = ?`
    )
    .get(playerId) as PlayerRow | undefined;
  return row ?? null;
}

type ClubRef = { id: number; name: string; crest: string | null; sortKey: string };

let crestByCanonical: Map<string, string> | null = null;
const latestClubCache = new Map<number, { id: number; name: string; crest: string | null } | null>();

function crestLookupByCanonical(): Map<string, string> {
  if (crestByCanonical) return crestByCanonical;
  const map = new Map<string, string>();
  const db = getDb();
  const teams = db
    .prepare(
      `SELECT name, crest FROM teams
       WHERE crest IS NOT NULL AND trim(crest) != ''
       ORDER BY id ASC`
    )
    .all() as Array<{ name: string; crest: string }>;
  for (const t of teams) {
    const key = canonicalClubKey(t.name);
    if (key && !map.has(key)) map.set(key, t.crest);
  }
  crestByCanonical = map;
  return map;
}

function parseTransferSortKey(date: string | null | undefined): string {
  if (!date) return '';
  const m = date.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return date;
}

function enrichClubCrest(club: {
  id: number;
  name: string;
  crest: string | null;
}): { id: number; name: string; crest: string | null } {
  if (club.crest && club.crest.trim()) return club;
  const key = canonicalClubKey(club.name);
  const fromCanonical = key
    ? (getClubCrest(key) ?? crestLookupByCanonical().get(key) ?? null)
    : null;
  const crest = resolveTeamCrest(club.name, fromCanonical);
  if (crest) return { ...club, crest };
  return club;
}

export function getLatestClub(
  playerId: number,
  modeId: GameModeId
): { id: number; name: string; crest: string | null } | null {
  void modeId;
  const cacheKey = resolveCanonicalPlayerId(playerId);
  if (latestClubCache.has(cacheKey)) {
    return latestClubCache.get(cacheKey) ?? null;
  }

  const db = getDb();
  const intlPlaceholders = INTERNATIONAL_COMPETITION_CODES.map(() => '?').join(',');
  const cluster = getPlayerIdentityCluster(playerId);
  const placeholders = cluster.map(() => '?').join(',');
  const signals: ClubRef[] = [];

  const fromLineups = db
    .prepare(
      `SELECT t.id, t.name, t.crest AS crest,
              COALESCE(
                m.utc_date,
                CASE WHEN s.season_year IS NOT NULL THEN printf('%04d-12-31', s.season_year) ELSE '' END,
                ''
              ) AS sortKey
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN teams t ON t.id = ml.team_id
       JOIN competitions c ON c.id = m.competition_id
       LEFT JOIN seasons s ON s.id = m.season_id
       WHERE ml.player_id IN (${placeholders})
         AND c.code NOT IN (${intlPlaceholders})
         AND t.name IS NOT NULL AND trim(t.name) != ''
       ORDER BY sortKey DESC, ml.id DESC
       LIMIT 1`
    )
    .get(...cluster, ...INTERNATIONAL_COMPETITION_CODES) as ClubRef | undefined;
  if (fromLineups?.name) signals.push(fromLineups);

  const fromStats = db
    .prepare(
      `SELECT t.id, t.name, t.crest AS crest,
              COALESCE(
                s.start_date,
                CASE WHEN s.season_year IS NOT NULL THEN printf('%04d-07-01', s.season_year) ELSE '' END,
                ''
              ) AS sortKey
       FROM player_season_stats pss
       JOIN seasons s ON s.id = pss.season_id
       JOIN teams t ON t.id = pss.team_id
       JOIN competitions c ON c.id = pss.competition_id
       WHERE pss.player_id IN (${placeholders})
         AND c.code NOT IN (${intlPlaceholders})
         AND t.name IS NOT NULL AND trim(t.name) != ''
       ORDER BY
         sortKey DESC,
         COALESCE(s.season_year, 0) DESC,
         COALESCE(pss.appearances, 0) DESC
       LIMIT 1`
    )
    .get(...cluster, ...INTERNATIONAL_COMPETITION_CODES) as ClubRef | undefined;
  if (fromStats?.name) signals.push(fromStats);

  const fromTransfers = db
    .prepare(
      `SELECT
          COALESCE(tt.id, tf.id, 0) AS id,
          COALESCE(NULLIF(tt.name, ''), NULLIF(tr.to_team_name, ''), NULLIF(tf.name, ''), NULLIF(tr.from_team_name, '')) AS name,
          COALESCE(tt.crest, tf.crest) AS crest,
          tr.transfer_date AS rawDate
       FROM transfers tr
       LEFT JOIN teams tt ON tt.id = tr.to_team_id
       LEFT JOIN teams tf ON tf.id = tr.from_team_id
       WHERE tr.player_id IN (${placeholders})
       ORDER BY tr.id DESC
       LIMIT 40`
    )
    .all(...cluster) as Array<{
    id: number;
    name: string | null;
    crest: string | null;
    rawDate: string | null;
  }>;

  let bestTransfer: ClubRef | null = null;
  for (const tr of fromTransfers) {
    if (!tr.name) continue;
    const sortKey = parseTransferSortKey(tr.rawDate);
    if (!bestTransfer || sortKey > bestTransfer.sortKey) {
      bestTransfer = {
        id: tr.id,
        name: tr.name,
        crest: tr.crest,
        sortKey,
      };
    }
  }
  if (bestTransfer) signals.push(bestTransfer);

  if (signals.length === 0) {
    latestClubCache.set(cacheKey, null);
    return null;
  }

  // Prefer recent lineups, then season stats; transfers only when nothing else exists.
  const priority = (signal: ClubRef): number => {
    const fromLineup = fromLineups && signal.id === fromLineups.id && signal.sortKey === fromLineups.sortKey;
    const fromStat = fromStats && signal.id === fromStats.id && signal.sortKey === fromStats.sortKey;
    if (fromLineup) return 3;
    if (fromStat) return 2;
    return 1;
  };

  signals.sort((a, b) => {
    const byDate = b.sortKey.localeCompare(a.sortKey);
    if (byDate !== 0) return byDate;
    return priority(b) - priority(a);
  });
  const latest = signals[0];
  const result = enrichClubCrest({ id: latest.id, name: latest.name, crest: latest.crest });
  latestClubCache.set(cacheKey, result);
  return result;
}

export function buildPlayerDisplay(playerId: number, modeId: GameModeId): PlayerDisplay | null {
  const row = getPlayerRowById(playerId);
  if (!row) return null;
  const canonicalId = resolveCanonicalPlayerId(playerId);
  const club = getLatestClub(canonicalId, modeId);
  const league = getLatestLeague(canonicalId, modeId);
  const shirtNumber = getLatestShirtNumber(canonicalId, modeId);
  return toPlayerDisplay(row, club, league, shirtNumber);
}

export function getPlayerById(
  playerId: number,
  modeId: GameModeId
): PlayerRow | null {
  const pool = getModePlayerPool(modeId);
  const direct = pool.find((p) => p.id === playerId);
  if (direct) return direct;

  const cluster = getPlayerIdentityCluster(resolveCanonicalPlayerId(playerId));
  for (const id of cluster) {
    const hit = pool.find((p) => p.id === id);
    if (hit) return hit;
  }
  return null;
}

export function getDailyPlayer(ctx: PuzzleContext): PlayerRow {
  const stored = getStoredPuzzle<{ playerId: number }>(
    'daily-player',
    ctx.modeId,
    ctx.difficulty,
    ctx.date,
    ctx.session
  );
  if (stored?.playerId) {
    const hit = getPlayerById(stored.playerId, ctx.modeId);
    if (hit) return hit;
  }

  const pool = getPlayerPool(ctx.modeId, ctx.difficulty);
  if (pool.length === 0) {
    throw new Error(`No players available for mode ${ctx.modeId} at ${ctx.difficulty} difficulty`);
  }
  const puzzleKey = buildPuzzleKey(ctx.modeId, ctx.difficulty, ctx.session);
  const index = getDailyIndex(ctx.date, puzzleKey, pool.length);
  const player = pool[index];
  savePuzzle('daily-player', ctx.modeId, ctx.difficulty, ctx.date, ctx.session, {
    playerId: player.id,
  });
  return player;
}

export function revealDailyPlayer(ctx: PuzzleContext): PlayerDisplay {
  const target = getDailyPlayer(ctx);
  const canonicalId = resolveCanonicalPlayerId(target.id);
  const club = getLatestClub(canonicalId, ctx.modeId);
  const league = getLatestLeague(canonicalId, ctx.modeId);
  const shirtNumber = getLatestShirtNumber(canonicalId, ctx.modeId);
  return toPlayerDisplay(target, club, league, shirtNumber);
}

export function compareGuess(
  guessPlayerId: number,
  ctx: PuzzleContext,
  attemptNumber: number
): GuessResponse {
  const target = getDailyPlayer(ctx);
  const guess = getPlayerById(guessPlayerId, ctx.modeId);

  if (!guess) {
    throw new Error('Player not in mode pool');
  }

  const targetClub = getLatestClub(target.id, ctx.modeId);
  const guessClub = getLatestClub(guess.id, ctx.modeId);
  const targetLeague = getLatestLeague(target.id, ctx.modeId);
  const guessLeague = getLatestLeague(guess.id, ctx.modeId);
  const targetShirt = getLatestShirtNumber(target.id, ctx.modeId);
  const guessShirt = getLatestShirtNumber(guess.id, ctx.modeId);

  const targetDisplay = toPlayerDisplay(target, targetClub, targetLeague, targetShirt);
  const guessDisplay = toPlayerDisplay(guess, guessClub, guessLeague, guessShirt);

  const comparison: ComparisonResult = {
    nationality: compareText(guess.nationality, target.nationality),
    league:
      guessLeague && targetLeague && guessLeague.id === targetLeague.id ? 'match' : 'miss',
    position: compareText(guess.position, target.position),
    club:
      guessClub && targetClub && guessClub.id === targetClub.id ? 'match' : 'miss',
    age: compareAge(getAge(guess.date_of_birth), getAge(target.date_of_birth)),
    shirtNumber: compareNumber(guessShirt, targetShirt),
  };

  const won =
    resolveCanonicalPlayerId(guess.id) === resolveCanonicalPlayerId(target.id);
  const gameOver = won || attemptNumber >= MAX_GUESSES;

  return {
    guess: guessDisplay,
    comparison,
    won,
    gameOver,
    revealed: gameOver ? targetDisplay : undefined,
  };
}
