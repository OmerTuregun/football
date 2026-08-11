import 'server-only';

import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import { type DifficultyId } from './difficulty-config';
import { getDb } from './db';
import { getGameMode, type GameModeId } from './game-modes';
import { MAX_SLOT_ATTEMPTS, type LinePos } from './missing-xi-shared';
import { extractGuessName } from './player-guess-name';
import {
  evaluateWordle,
  normalizeAnswerLetters,
  wordLetterCounts,
  type TileStatus,
} from './wordle';

export { MAX_SLOT_ATTEMPTS, type LinePos } from './missing-xi-shared';

export interface MissingXiSlotPublic {
  index: number;
  shirtNumber: number | null;
  position: LinePos;
  letterCounts: number[];
  totalLetters: number;
}

export interface MissingXiMatchMeta {
  matchId: number;
  teamId: number;
  competitionCode: string;
  competitionName: string;
  seasonLabel: string;
  date: string | null;
  focusTeam: { id: number; name: string; crest: string | null };
  opponent: { id: number; name: string; crest: string | null };
  isHome: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface MissingXiPuzzle {
  meta: MissingXiMatchMeta;
  slots: MissingXiSlotPublic[];
}

export interface MissingXiSlotSecret {
  index: number;
  playerId: number;
  /** Full display name */
  name: string;
  /** Surname / mononym used for guessing */
  answer: string;
  shirtNumber: number | null;
  position: LinePos;
}

interface PoolEntry {
  matchId: number;
  teamId: number;
  teamName: string;
}

interface TeamBucket {
  key: string;
  entries: PoolEntry[];
}

const ELITE_NAME_NEEDLES = [
  'real madrid',
  'barcelona',
  'bayern',
  'manchester city',
  'liverpool',
  'arsenal',
  'chelsea',
  'manchester united',
  'juventus',
  'napoli',
  'paris s.g',
  'paris saint',
  'psg',
  'atletico madrid',
  'atlético madrid',
  'club atlético de madrid',
  'dortmund',
  'tottenham',
  'internazionale',
];

const KNOWN_NAME_NEEDLES = [
  ...ELITE_NAME_NEEDLES,
  'tottenham',
  'newcastle',
  'leipzig',
  'leverkusen',
  'benfica',
  'porto',
  'ajax',
  'psv',
  'sevilla',
  'villarreal',
  'roma',
  'lazio',
  'atalanta',
  'wolfsburg',
  'monaco',
  'marseille',
  'lyon',
  'celtic',
  'real sociedad',
  'sporting',
  'galatasaray',
  'fenerbahce',
  'fenerbahçe',
  'besiktas',
  'beşiktaş',
  'west ham',
  'aston villa',
  'brighton',
  'milan',
  'inter',
];

const MEDIUM_COMP_CODES = new Set(['PL', 'BL1', 'PD', 'SA', 'FL1', 'CL', 'EL']);
const HARD_COMP_CODES = new Set([
  'PL',
  'BL1',
  'PD',
  'SA',
  'FL1',
  'CL',
  'EL',
  'SL',
  'PPL',
  'DED',
  'ECL',
]);

/** Collapse StatPal name variants so "Bayern Munich" ≈ "FC Bayern München". */
const CANONICAL_CLUB_KEYS: Array<{ key: string; needles: string[] }> = [
  { key: 'bayern', needles: ['bayern'] },
  { key: 'dortmund', needles: ['dortmund'] },
  { key: 'real-madrid', needles: ['real madrid'] },
  { key: 'barcelona', needles: ['barcelona'] },
  { key: 'atletico', needles: ['atletico madrid', 'atlético madrid', 'club atlético'] },
  { key: 'man-city', needles: ['manchester city'] },
  { key: 'man-utd', needles: ['manchester united'] },
  { key: 'liverpool', needles: ['liverpool'] },
  { key: 'arsenal', needles: ['arsenal'] },
  { key: 'chelsea', needles: ['chelsea'] },
  { key: 'tottenham', needles: ['tottenham'] },
  { key: 'juventus', needles: ['juventus'] },
  { key: 'inter', needles: ['internazionale'] },
  { key: 'milan', needles: ['ac milan'] },
  { key: 'napoli', needles: ['napoli'] },
  { key: 'psg', needles: ['paris s.g', 'paris saint', 'psg'] },
  { key: 'leipzig', needles: ['leipzig'] },
  { key: 'leverkusen', needles: ['leverkusen'] },
];

const poolCache = new Map<string, TeamBucket[]>();
const secretCache = new Map<string, MissingXiSlotSecret[]>();

function normalizeTeamKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('tr-TR');
}

function canonicalClubKey(name: string): string {
  const key = normalizeTeamKey(name);
  for (const club of CANONICAL_CLUB_KEYS) {
    if (club.needles.some((n) => key.includes(n))) return club.key;
  }
  if (key === 'inter' || key.startsWith('inter ')) return 'inter';
  if (key === 'milan' || (/\bmilan\b/.test(key) && !key.includes('inter'))) return 'milan';
  return `id:${key}`;
}

function matchesNeedle(name: string, needles: string[]): boolean {
  const key = normalizeTeamKey(name);
  return needles.some((n) => {
    if (n === 'milan') {
      return (
        key === 'milan' ||
        key.includes('ac milan') ||
        key.includes('milan ac') ||
        (/\bmilan\b/.test(key) && !key.includes('inter'))
      );
    }
    if (n === 'inter') {
      return key === 'inter' || key.startsWith('inter ') || key.includes('internazionale');
    }
    return key.includes(n);
  });
}

function isEliteTeam(name: string): boolean {
  return matchesNeedle(name, ELITE_NAME_NEEDLES) || matchesNeedle(name, ['milan', 'inter']);
}

function isKnownTeam(name: string): boolean {
  return matchesNeedle(name, KNOWN_NAME_NEEDLES);
}

function toLinePos(raw: string | null): LinePos {
  const p = (raw ?? '').toUpperCase();
  if (p === 'G' || p === 'D' || p === 'M' || p === 'F') return p;
  return 'X';
}

function seasonLabelFromDate(utcDate: string | null, seasonYear: number | null): string {
  if (utcDate && utcDate.length >= 7) {
    const y = Number(utcDate.slice(0, 4));
    const month = Number(utcDate.slice(5, 7));
    if (!Number.isNaN(y) && !Number.isNaN(month)) {
      if (month >= 7) return `${y}/${String(y + 1).slice(2)}`;
      return `${y - 1}/${String(y).slice(2)}`;
    }
  }
  if (seasonYear) return String(seasonYear);
  return '—';
}

function cacheKey(modeId: GameModeId, difficulty: DifficultyId): string {
  return `${modeId}:${difficulty}`;
}

function puzzleSecretKey(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): string {
  return `${modeId}:${difficulty}:${date}:${session}`;
}

function allowedCompetitionCodes(
  modeId: GameModeId,
  difficulty: DifficultyId
): Set<string> | null {
  const mode = getGameMode(modeId);
  if (mode.competitionIds) {
    const db = getDb();
    const placeholders = mode.competitionIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT code FROM competitions WHERE id IN (${placeholders})`)
      .all(...mode.competitionIds) as { code: string | null }[];
    const codes = new Set(rows.map((r) => r.code).filter((c): c is string => !!c));
    if (codes.size === 0) return new Set();
    return codes;
  }

  if (difficulty === 'easy' || difficulty === 'medium') return MEDIUM_COMP_CODES;
  return HARD_COMP_CODES;
}

function buildTeamBuckets(modeId: GameModeId, difficulty: DifficultyId): TeamBucket[] {
  const key = cacheKey(modeId, difficulty);
  const cached = poolCache.get(key);
  if (cached) return cached;

  const codes = allowedCompetitionCodes(modeId, difficulty);
  if (!codes || codes.size === 0) {
    poolCache.set(key, []);
    return [];
  }

  const db = getDb();
  const codeList = [...codes];
  const placeholders = codeList.map(() => '?').join(',');

  const rows = db
    .prepare(
      `SELECT m.id AS match_id, ml.team_id AS team_id, t.name AS team_name, c.code AS comp_code
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN teams t ON t.id = ml.team_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE ml.is_starter = 1
         AND c.code IN (${placeholders})
       GROUP BY m.id, ml.team_id, t.name, c.code
       HAVING COUNT(*) = 11`
    )
    .all(...codeList) as Array<{
    match_id: number;
    team_id: number;
    team_name: string;
    comp_code: string;
  }>;

  const buckets = new Map<string, PoolEntry[]>();

  for (const row of rows) {
    if (difficulty === 'easy') {
      if (!isEliteTeam(row.team_name)) continue;
    } else if (difficulty === 'medium') {
      if (
        !isKnownTeam(row.team_name) &&
        !['PL', 'BL1', 'PD', 'SA', 'FL1', 'CL'].includes(row.comp_code)
      ) {
        continue;
      }
    }

    const bucketKey =
      difficulty === 'easy' || difficulty === 'medium'
        ? canonicalClubKey(row.team_name)
        : `team:${row.team_id}`;

    const list = buckets.get(bucketKey) ?? [];
    list.push({
      matchId: row.match_id,
      teamId: row.team_id,
      teamName: row.team_name,
    });
    buckets.set(bucketKey, list);
  }

  const out: TeamBucket[] = [...buckets.entries()]
    .map(([bucketKey, entries]) => ({ key: bucketKey, entries }))
    .sort((a, b) => a.key.localeCompare(b.key));

  poolCache.set(key, out);
  return out;
}

function loadSecrets(matchId: number, teamId: number): MissingXiSlotSecret[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id AS player_id, p.name, ml.shirt_number, ml.position
       FROM match_lineups ml
       JOIN players p ON p.id = ml.player_id
       WHERE ml.match_id = ? AND ml.team_id = ? AND ml.is_starter = 1
       ORDER BY
         CASE UPPER(COALESCE(ml.position,''))
           WHEN 'F' THEN 0 WHEN 'M' THEN 1 WHEN 'D' THEN 2 WHEN 'G' THEN 3 ELSE 4
         END,
         CASE WHEN ml.shirt_number IS NULL THEN 1 ELSE 0 END,
         ml.shirt_number ASC,
         p.name ASC`
    )
    .all(matchId, teamId) as Array<{
    player_id: number;
    name: string;
    shirt_number: number | null;
    position: string | null;
  }>;

  if (rows.length !== 11) {
    throw new Error('Expected 11 starters');
  }

  return rows.map((row, index) => ({
    index,
    playerId: row.player_id,
    name: row.name,
    answer: extractGuessName(row.name),
    shirtNumber: row.shirt_number,
    position: toLinePos(row.position),
  }));
}

function loadMeta(matchId: number, teamId: number): MissingXiMatchMeta {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id AS match_id, m.utc_date, m.home_score, m.away_score,
              m.home_team_id, m.away_team_id,
              c.code AS competition_code, c.name AS competition_name,
              s.season_year,
              th.id AS home_id, th.name AS home_name, th.crest AS home_crest,
              ta.id AS away_id, ta.name AS away_name, ta.crest AS away_crest
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       LEFT JOIN seasons s ON s.id = m.season_id
       JOIN teams th ON th.id = m.home_team_id
       JOIN teams ta ON ta.id = m.away_team_id
       WHERE m.id = ?`
    )
    .get(matchId) as
    | {
        match_id: number;
        utc_date: string | null;
        home_score: number | null;
        away_score: number | null;
        home_team_id: number;
        away_team_id: number;
        competition_code: string;
        competition_name: string;
        season_year: number | null;
        home_id: number;
        home_name: string;
        home_crest: string | null;
        away_id: number;
        away_name: string;
        away_crest: string | null;
      }
    | undefined;

  if (!row) throw new Error('Match not found');

  const isHome = row.home_team_id === teamId;
  const focus = isHome
    ? { id: row.home_id, name: row.home_name, crest: row.home_crest }
    : { id: row.away_id, name: row.away_name, crest: row.away_crest };
  const opponent = isHome
    ? { id: row.away_id, name: row.away_name, crest: row.away_crest }
    : { id: row.home_id, name: row.home_name, crest: row.home_crest };

  return {
    matchId: row.match_id,
    teamId,
    competitionCode: row.competition_code,
    competitionName: row.competition_name,
    seasonLabel: seasonLabelFromDate(row.utc_date, row.season_year),
    date: row.utc_date,
    focusTeam: focus,
    opponent,
    isHome,
    homeScore: row.home_score,
    awayScore: row.away_score,
  };
}

/**
 * Pick team uniformly (not by match count), then a match for that team.
 * Session advances rotate the team so "Tekrar oyna" won't spam Bayern/Dortmund.
 */
function getTargetEntry(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): PoolEntry {
  const stored = getStoredPuzzle<{ matchId: number; teamId: number }>(
    'missing-xi',
    modeId,
    difficulty,
    date,
    session
  );
  if (stored?.matchId && stored?.teamId) {
    return stored as PoolEntry;
  }

  const buckets = buildTeamBuckets(modeId, difficulty);
  if (buckets.length === 0) {
    throw new Error('No eligible Missing XI puzzles for this mode/difficulty');
  }

  const baseTeam = getDailyIndex(
    date,
    `${buildPuzzleKey(modeId, difficulty, 0)}:team`,
    buckets.length
  );
  const teamIndex = (baseTeam + session) % buckets.length;
  const bucket = buckets[teamIndex];

  const matchIndex = getDailyIndex(
    date,
    `${buildPuzzleKey(modeId, difficulty, session)}:match`,
    bucket.entries.length
  );
  const entry = bucket.entries[matchIndex];
  savePuzzle('missing-xi', modeId, difficulty, date, session, {
    matchId: entry.matchId,
    teamId: entry.teamId,
  });
  return entry;
}

function getSecretsForPuzzle(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): { meta: MissingXiMatchMeta; secrets: MissingXiSlotSecret[] } {
  const key = puzzleSecretKey(modeId, difficulty, date, session);
  const entry = getTargetEntry(modeId, difficulty, date, session);
  const meta = loadMeta(entry.matchId, entry.teamId);

  let secrets = secretCache.get(key);
  if (!secrets) {
    secrets = loadSecrets(entry.matchId, entry.teamId);
    secretCache.set(key, secrets);
  }

  return { meta, secrets };
}

export function createMissingXiPuzzle(
  modeId: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): MissingXiPuzzle {
  const { meta, secrets } = getSecretsForPuzzle(modeId, difficulty, date, session);

  const slots: MissingXiSlotPublic[] = secrets.map((s) => {
    const counts = wordLetterCounts(s.answer);
    return {
      index: s.index,
      shirtNumber: s.shirtNumber,
      position: s.position,
      letterCounts: counts,
      totalLetters: counts.reduce((a, b) => a + b, 0),
    };
  });

  return { meta, slots };
}

export function guessMissingXiSlot(params: {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
  slotIndex: number;
  guess: string;
  attemptNumber: number;
}): {
  tiles: TileStatus[];
  correct: boolean;
  gameOverSlot: boolean;
  remainingAttempts: number;
  revealedName?: string;
  playerId?: number;
} {
  const { modeId, difficulty, date, session, slotIndex, guess, attemptNumber } = params;

  if (slotIndex < 0 || slotIndex > 10) throw new Error('Invalid slot');
  if (attemptNumber < 1 || attemptNumber > MAX_SLOT_ATTEMPTS) {
    throw new Error('Invalid attempt number');
  }

  const { secrets } = getSecretsForPuzzle(modeId, difficulty, date, session);
  const secret = secrets[slotIndex];
  if (!secret) throw new Error('Invalid slot');

  const answerLetters = normalizeAnswerLetters(secret.answer);
  const guessLetters = normalizeAnswerLetters(guess);

  if (guessLetters.length !== answerLetters.length) {
    throw new Error(`Guess must be ${answerLetters.length} letters`);
  }

  const tiles = evaluateWordle(guessLetters, answerLetters);
  const correct = tiles.every((t) => t === 'correct');
  const gameOverSlot = correct || attemptNumber >= MAX_SLOT_ATTEMPTS;
  const remainingAttempts = Math.max(0, MAX_SLOT_ATTEMPTS - attemptNumber);

  const result: {
    tiles: TileStatus[];
    correct: boolean;
    gameOverSlot: boolean;
    remainingAttempts: number;
    revealedName?: string;
    revealedFullName?: string;
    playerId?: number;
  } = {
    tiles,
    correct,
    gameOverSlot,
    remainingAttempts,
  };

  if (correct || gameOverSlot) {
    result.revealedName = secret.answer;
    result.revealedFullName = secret.name;
    result.playerId = secret.playerId;
  }

  return result;
}

export function revealMissingXi(params: {
  modeId: GameModeId;
  difficulty: DifficultyId;
  date: string;
  session: number;
}): {
  meta: MissingXiMatchMeta;
  players: Array<{
    index: number;
    playerId: number;
    name: string;
    fullName: string;
    shirtNumber: number | null;
    position: LinePos;
  }>;
} {
  const { meta, secrets } = getSecretsForPuzzle(
    params.modeId,
    params.difficulty,
    params.date,
    params.session
  );

  return {
    meta,
    players: secrets.map((s) => ({
      index: s.index,
      playerId: s.playerId,
      name: s.answer,
      fullName: s.name,
      shirtNumber: s.shirtNumber,
      position: s.position,
    })),
  };
}
