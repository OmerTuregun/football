import 'server-only';

import {
  canonicalClubKey,
  eliteClubKeys,
  knownClubKeys,
} from './club-canonical';
import { getClubCrest, getClubLabel } from './club-membership';
import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import type { DifficultyId } from './difficulty-config';
import { getDb } from './db';
import {
  ONLUK_LIVES,
  ONLUK_SIZE,
  type OnlukQuestionKind,
} from './onluk-shared';
import { resolveCanonicalPlayerId } from './player-identity';

export interface OnlukAnswer {
  rank: number;
  playerId: number;
  name: string;
  value: number;
  valueLabel: string;
}

export interface OnlukPuzzle {
  kind: OnlukQuestionKind;
  title: string;
  note: string;
  /** Short chip under ONLUK, e.g. club names / player */
  subtitle: string;
  crestA: string | null;
  crestB: string | null;
  unit: string;
  answers: OnlukAnswer[];
  seasonFrom: number;
  seasonTo: number;
}

export interface OnlukPuzzlePublic {
  kind: OnlukQuestionKind;
  title: string;
  note: string;
  subtitle: string;
  crestA: string | null;
  crestB: string | null;
  unit: string;
  targetCount: number;
  lives: number;
  seasonFrom: number;
  seasonTo: number;
  date: string;
  session: number;
}

export interface OnlukGuessResult {
  correct: boolean;
  livesLeft: number;
  streakCorrect: number;
  placed: OnlukAnswer | null;
  placedCount: number;
  won: boolean;
  lost: boolean;
  gameOver: boolean;
}

interface RankRow {
  playerId: number;
  name: string;
  value: number;
}

interface Spec {
  kind: OnlukQuestionKind;
  title: string;
  subtitle: string;
  crestA: string | null;
  crestB: string | null;
  unit: string;
  rows: RankRow[];
}

const puzzleCache = new Map<string, OnlukPuzzle>();

function cacheKey(difficulty: DifficultyId, date: string, session: number): string {
  return `${difficulty}:${date}:${session}`;
}

function isYouthOrSecondary(name: string): boolean {
  const n = name.normalize('NFC').toLocaleLowerCase('tr-TR');
  return (
    /\bu1[89]\b/.test(n) ||
    /\bu2[0-3]\b/.test(n) ||
    /\bu23\b/.test(n) ||
    n.includes('castilla') ||
    n.includes('reserves') ||
    n.includes('youth') ||
    n.includes('women') ||
    n.includes(' academy') ||
    n.endsWith(' b') ||
    n.endsWith(' c') ||
    n.includes(' b ') ||
    /\bii\b/.test(n) ||
    n.includes('u19') ||
    n.includes('u21')
  );
}

function seasonWindow(db: ReturnType<typeof getDb>): { from: number; to: number } {
  const row = db
    .prepare(
      `SELECT MAX(s.season_year) AS y
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions c ON c.id = m.competition_id
       WHERE c.code IN ('PL', 'PD', 'BL1', 'SA', 'FL1', 'CL')
         AND s.season_year IS NOT NULL`
    )
    .get() as { y: number | null } | undefined;
  const to = row?.y && row.y > 2000 ? row.y : 2025;
  return { from: to - 2, to };
}

function seniorTeamIdsForClub(db: ReturnType<typeof getDb>, clubKey: string): number[] {
  const rows = db.prepare(`SELECT id, name FROM teams`).all() as Array<{
    id: number;
    name: string;
  }>;
  return rows
    .filter((t) => canonicalClubKey(t.name) === clubKey && !isYouthOrSecondary(t.name))
    .map((t) => t.id);
}

function formatValue(unit: string, value: number): string {
  if (unit === 'gol') return `${value} gol`;
  if (unit === 'ortak maç') return `${value} ortak maç`;
  return `${value} maç`;
}

/** Combine split DB rows (football-data + StatPal) before ranking. */
function mergeRankRowsByCanonical(rows: RankRow[]): RankRow[] {
  const byCanonical = new Map<number, RankRow>();
  for (const row of rows) {
    const canonicalId = resolveCanonicalPlayerId(row.playerId);
    const existing = byCanonical.get(canonicalId);
    if (existing) {
      existing.value += row.value;
      if (row.name.length > existing.name.length) existing.name = row.name;
    } else {
      byCanonical.set(canonicalId, {
        playerId: canonicalId,
        name: row.name,
        value: row.value,
      });
    }
  }
  return [...byCanonical.values()].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name, 'tr')
  );
}

function toAnswers(rows: RankRow[], unit: string): OnlukAnswer[] {
  return rows.slice(0, ONLUK_SIZE).map((r, i) => ({
    rank: i + 1,
    playerId: r.playerId,
    name: r.name,
    value: r.value,
    valueLabel: formatValue(unit, r.value),
  }));
}

function clubAppearanceSpec(
  db: ReturnType<typeof getDb>,
  clubKey: string,
  from: number,
  to: number
): Spec | null {
  const teamIds = seniorTeamIdsForClub(db, clubKey);
  if (teamIds.length === 0) return null;
  const placeholders = teamIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.id AS playerId, p.name, COUNT(DISTINCT ml.match_id) AS value
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN players p ON p.id = ml.player_id
       WHERE ml.team_id IN (${placeholders})
         AND s.season_year BETWEEN ? AND ?
       GROUP BY p.id
       HAVING value > 0
       ORDER BY value DESC, p.name COLLATE NOCASE ASC
       LIMIT ?`
    )
    .all(...teamIds, from, to, ONLUK_SIZE + 5) as RankRow[];

  if (rows.length < ONLUK_SIZE) return null;
  const merged = mergeRankRowsByCanonical(rows);
  if (merged.length < ONLUK_SIZE) return null;
  const label = getClubLabel(clubKey);
  return {
    kind: 'club-appearances',
    title: `${label} formasıyla en çok maça çıkanlar`,
    subtitle: label,
    crestA: getClubCrest(clubKey),
    crestB: null,
    unit: 'maç',
    rows: merged.slice(0, ONLUK_SIZE),
  };
}

function teammateSpec(
  db: ReturnType<typeof getDb>,
  anchorId: number,
  from: number,
  to: number
): Spec | null {
  const anchor = db
    .prepare(`SELECT id, name FROM players WHERE id = ?`)
    .get(anchorId) as { id: number; name: string } | undefined;
  if (!anchor) return null;

  const rows = db
    .prepare(
      `SELECT p.id AS playerId, p.name, COUNT(DISTINCT ml2.match_id) AS value
       FROM match_lineups ml1
       JOIN matches m ON m.id = ml1.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN match_lineups ml2
         ON ml2.match_id = ml1.match_id
        AND ml2.team_id = ml1.team_id
        AND ml2.player_id != ml1.player_id
       JOIN players p ON p.id = ml2.player_id
       WHERE ml1.player_id = ?
         AND s.season_year BETWEEN ? AND ?
       GROUP BY p.id
       HAVING value > 0
       ORDER BY value DESC, p.name COLLATE NOCASE ASC
       LIMIT ?`
    )
    .all(anchorId, from, to, ONLUK_SIZE + 5) as RankRow[];

  if (rows.length < ONLUK_SIZE) return null;
  const merged = mergeRankRowsByCanonical(rows);
  if (merged.length < ONLUK_SIZE) return null;

  // Crest: most common team with this player in window
  const team = db
    .prepare(
      `SELECT t.name, t.crest, COUNT(*) n
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN teams t ON t.id = ml.team_id
       WHERE ml.player_id = ?
         AND s.season_year BETWEEN ? AND ?
         AND t.crest IS NOT NULL AND trim(t.crest) != ''
       GROUP BY t.id
       ORDER BY n DESC
       LIMIT 1`
    )
    .get(anchorId, from, to) as { name: string; crest: string } | undefined;

  return {
    kind: 'teammate-appearances',
    title: `${anchor.name} ile aynı XI’de en çok bulunanlar`,
    subtitle: anchor.name,
    crestA: team?.crest ?? null,
    crestB: null,
    unit: 'ortak maç',
    rows: merged.slice(0, ONLUK_SIZE),
  };
}

function competitionGoalsSpec(
  db: ReturnType<typeof getDb>,
  code: string,
  competitionLabel: string,
  from: number,
  to: number
): Spec | null {
  const eliteKeys = new Set(eliteClubKeys());
  const teams = db.prepare(`SELECT id, name, crest FROM teams`).all() as Array<{
    id: number;
    name: string;
    crest: string | null;
  }>;
  const eliteTeamIds = teams
    .filter((t) => {
      const key = canonicalClubKey(t.name);
      return key && eliteKeys.has(key) && !isYouthOrSecondary(t.name);
    })
    .map((t) => t.id);
  if (eliteTeamIds.length < 8) return null;

  const placeholders = eliteTeamIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.id AS playerId, p.name, SUM(COALESCE(pss.goals, 0)) AS value
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN competitions c ON c.id = pss.competition_id
       JOIN seasons s ON s.id = pss.season_id
       WHERE c.code = ?
         AND s.season_year BETWEEN ? AND ?
         AND pss.team_id IN (${placeholders})
         AND COALESCE(pss.goals, 0) > 0
         AND (pss.stat_source = 'statpal' OR COALESCE(pss.appearances, 0) > 0)
       GROUP BY p.id
       HAVING value > 0
       ORDER BY value DESC, p.name COLLATE NOCASE ASC
       LIMIT ?`
    )
    .all(code, from, to, ...eliteTeamIds, ONLUK_SIZE + 5) as RankRow[];

  if (rows.length < ONLUK_SIZE) return null;
  const merged = mergeRankRowsByCanonical(rows);
  if (merged.length < ONLUK_SIZE) return null;
  // Require a minimally believable board (avoid all 1-goal boards)
  if (merged[0]!.value < 3) return null;

  return {
    kind: 'competition-goals',
    title: `${competitionLabel}’nde en çok gol atanlar`,
    subtitle: competitionLabel,
    crestA: null,
    crestB: null,
    unit: 'gol',
    rows: merged.slice(0, ONLUK_SIZE),
  };
}

function listAnchorPlayers(
  db: ReturnType<typeof getDb>,
  clubKeys: string[],
  from: number,
  to: number,
  limit: number
): number[] {
  const teamIds = clubKeys.flatMap((k) => seniorTeamIdsForClub(db, k));
  if (teamIds.length === 0) return [];
  const placeholders = teamIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT p.id AS id, COUNT(DISTINCT ml.match_id) AS apps
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN players p ON p.id = ml.player_id
       WHERE ml.team_id IN (${placeholders})
         AND s.season_year BETWEEN ? AND ?
         AND p.statpal_id IS NOT NULL
       GROUP BY p.id
       HAVING apps >= 40
       ORDER BY apps DESC
       LIMIT ?`
    )
    .all(...teamIds, from, to, limit) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function buildSpecPool(difficulty: DifficultyId): Spec[] {
  const db = getDb();
  const { from, to } = seasonWindow(db);
  const clubKeys =
    difficulty === 'easy' ? eliteClubKeys() : knownClubKeys().slice(0, 28);

  const specs: Spec[] = [];

  for (const key of clubKeys) {
    const spec = clubAppearanceSpec(db, key, from, to);
    if (spec) specs.push(spec);
  }

  const anchors = listAnchorPlayers(db, clubKeys.slice(0, 16), from, to, difficulty === 'easy' ? 24 : 40);
  for (const id of anchors) {
    const spec = teammateSpec(db, id, from, to);
    if (spec) specs.push(spec);
  }

  const cl = competitionGoalsSpec(db, 'CL', 'Şampiyonlar Ligi', from, to);
  if (cl) specs.push(cl);

  // Stable order for daily index
  specs.sort((a, b) => `${a.kind}:${a.title}`.localeCompare(`${b.kind}:${b.title}`, 'tr'));
  return specs;
}

export function createOnlukPuzzle(
  difficulty: DifficultyId,
  date: string,
  session: number
): OnlukPuzzle {
  const key = cacheKey(difficulty, date, session);
  const cached = puzzleCache.get(key);
  if (cached) return cached;

  const stored = getStoredPuzzle<OnlukPuzzle>('onluk', 'general', difficulty, date, session);
  if (stored) {
    puzzleCache.set(key, stored);
    return stored;
  }

  const db = getDb();
  const { from, to } = seasonWindow(db);
  const pool = buildSpecPool(difficulty);
  if (pool.length === 0) {
    throw new Error('No eligible Onluk boards for this difficulty');
  }

  const puzzleKey = buildPuzzleKey('onluk-top10', difficulty, session);
  const spec = pool[getDailyIndex(date, puzzleKey, pool.length)];
  const answers = toAnswers(spec.rows, spec.unit);

  const puzzle: OnlukPuzzle = {
    kind: spec.kind,
    title: spec.title,
    note: `Son 3 sezon · ${from}/${String(from + 1).slice(2)} – ${to}/${String(to + 1).slice(2)}`,
    subtitle: spec.subtitle,
    crestA: spec.crestA,
    crestB: spec.crestB,
    unit: spec.unit,
    answers,
    seasonFrom: from,
    seasonTo: to,
  };
  savePuzzle('onluk', 'general', difficulty, date, session, puzzle);
  puzzleCache.set(key, puzzle);
  return puzzle;
}

export function toPublicPuzzle(
  puzzle: OnlukPuzzle,
  date: string,
  session: number
): OnlukPuzzlePublic {
  return {
    kind: puzzle.kind,
    title: puzzle.title,
    note: puzzle.note,
    subtitle: puzzle.subtitle,
    crestA: puzzle.crestA,
    crestB: puzzle.crestB,
    unit: puzzle.unit,
    targetCount: ONLUK_SIZE,
    lives: ONLUK_LIVES,
    seasonFrom: puzzle.seasonFrom,
    seasonTo: puzzle.seasonTo,
    date,
    session,
  };
}

export function guessOnluk(params: {
  difficulty: DifficultyId;
  date: string;
  session: number;
  playerId: number;
  placedIds: number[];
  livesLeft: number;
  streakCorrect?: number;
}): OnlukGuessResult {
  const {
    difficulty,
    date,
    session,
    playerId,
    placedIds,
    livesLeft,
    streakCorrect = 0,
  } = params;
  if (livesLeft <= 0) throw new Error('No lives left');
  if (placedIds.length >= ONLUK_SIZE) throw new Error('Puzzle already complete');

  const puzzle = createOnlukPuzzle(difficulty, date, session);
  const canonicalId = resolveCanonicalPlayerId(playerId);
  const placedCanonical = new Set(placedIds.map((id) => resolveCanonicalPlayerId(id)));
  if (placedCanonical.has(canonicalId)) {
    throw new Error('Player already placed');
  }

  const hit = puzzle.answers.find(
    (a) => resolveCanonicalPlayerId(a.playerId) === canonicalId
  );

  if (!hit) {
    const nextLives = livesLeft - 1;
    const lost = nextLives <= 0;
    return {
      correct: false,
      livesLeft: nextLives,
      streakCorrect: 0,
      placed: null,
      placedCount: placedIds.length,
      won: false,
      lost,
      gameOver: lost,
    };
  }

  let nextStreak = streakCorrect + 1;
  let nextLives = livesLeft;
  if (nextStreak >= 2 && nextLives < ONLUK_LIVES) {
    nextLives += 1;
    nextStreak = 0;
  }

  const placedCount = placedIds.length + 1;
  const won = placedCount >= ONLUK_SIZE;
  return {
    correct: true,
    livesLeft: nextLives,
    streakCorrect: nextStreak,
    placed: hit,
    placedCount,
    won,
    lost: false,
    gameOver: won,
  };
}

export function revealOnlukAnswers(
  difficulty: DifficultyId,
  date: string,
  session: number
): { puzzle: OnlukPuzzlePublic; answers: OnlukAnswer[] } {
  const puzzle = createOnlukPuzzle(difficulty, date, session);
  return {
    puzzle: toPublicPuzzle(puzzle, date, session),
    answers: puzzle.answers,
  };
}
