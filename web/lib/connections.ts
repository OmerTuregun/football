import 'server-only';

import { canonicalClubKey, eliteClubKeys } from './club-canonical';
import { buildPuzzleKey, getDailyIndex } from './daily-hash';
import { getStoredPuzzle, savePuzzle } from './daily-puzzles';
import type { DifficultyId } from './difficulty-config';
import { getDb } from './db';
import { resolveCanonicalPlayerId } from './player-identity';
import {
  CONNECTIONS_BOARD,
  CONNECTIONS_COLORS,
  CONNECTIONS_GROUP_COUNT,
  CONNECTIONS_GROUP_SIZE,
  CONNECTIONS_MISTAKES,
  type ConnectionsColor,
} from './connections-shared';

export interface ConnectionsPlayerCard {
  id: number;
  name: string;
  nationality: string;
  position: string;
  clubCrest: string | null;
}

export interface ConnectionsGroup {
  id: string;
  label: string;
  traits: string[];
  color: ConnectionsColor;
  playerIds: number[];
}

export interface ConnectionsPuzzle {
  groups: ConnectionsGroup[];
  players: ConnectionsPlayerCard[];
  /** Board order (shuffled player ids) */
  board: number[];
}

export interface ConnectionsPuzzlePublic {
  date: string;
  session: number;
  difficulty: DifficultyId;
  mistakes: number;
  players: ConnectionsPlayerCard[];
  board: number[];
}

export interface ConnectionsGroupPublic {
  id: string;
  label: string;
  traits: string[];
  color: ConnectionsColor;
  playerIds: number[];
  players: Array<{ id: number; name: string }>;
}

export interface ConnectionsGuessResult {
  correct: boolean;
  oneAway: boolean;
  mistakesLeft: number;
  solvedGroup: ConnectionsGroupPublic | null;
  won: boolean;
  lost: boolean;
  remainingGroups?: ConnectionsGroupPublic[];
}

interface Candidate {
  signature: string;
  kind: string;
  label: string;
  traits: string[];
  playerIds: number[];
  rarity: number;
  elite: boolean;
  /** Same club must not appear twice on one board */
  clubAxis: string | null;
  /** Same nationality trait must not appear twice on one board */
  natAxis: string | null;
}

interface PlayerMeta {
  id: number;
  name: string;
  nationality: string;
  position: string;
  clubCrest: string | null;
}

const puzzleCache = new Map<string, ConnectionsPuzzle>();
let candidateCache: Candidate[] | null = null;
let playerMetaCache: Map<number, PlayerMeta> | null = null;
let visibilityCache: Map<number, number> | null = null;

function cacheKey(difficulty: DifficultyId, date: string, session: number): string {
  return `${difficulty}:${date}:${session}`;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function isYouthOrSecondary(name: string): boolean {
  const n = name.normalize('NFC').toLocaleLowerCase('tr-TR');
  const nEn = name.normalize('NFC').toLowerCase();
  return (
    /\bu1[89]\b/.test(nEn) ||
    /\bu2[0-3]\b/.test(nEn) ||
    /\bii\b/.test(nEn) ||
    n.includes('castilla') ||
    n.includes('reserves') ||
    n.includes('youth') ||
    n.includes('women') ||
    n.includes(' academy') ||
    n.endsWith(' b') ||
    n.endsWith(' c') ||
    n.includes(' b ') ||
    n.includes(' 2') ||
    n.endsWith(' 2') ||
    /\b2\b/.test(nEn)
  );
}

function positionFamily(pos: string | null | undefined): string | null {
  if (!pos) return null;
  const p = pos.toLowerCase();
  if (p.includes('goal')) return 'Kaleci';
  if (
    p.includes('defen') ||
    p.includes('back') ||
    p.includes('defence') ||
    p.includes('defense')
  ) {
    return 'Savunma';
  }
  if (p.includes('mid')) return 'Orta saha';
  if (
    p.includes('attack') ||
    p.includes('forward') ||
    p.includes('wing') ||
    p.includes('striker') ||
    p.includes('centre-forward')
  ) {
    return 'Forvet';
  }
  return null;
}

function seasonLabel(year: number): string {
  return `${year}/${String(year + 1).slice(-2)}`;
}

function clubAxisKey(teamId: number, teamName: string): string {
  return canonicalClubKey(teamName) ?? `team:${teamId}`;
}

function natAxisKey(nationality: string): string {
  return nationality.trim().toLocaleLowerCase('en-US');
}

function uniqCanonical(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    const cid = resolveCanonicalPlayerId(id);
    if (seen.has(cid)) continue;
    seen.add(cid);
    out.push(cid);
  }
  return out;
}

function loadPlayerMeta(): Map<number, PlayerMeta> {
  if (playerMetaCache) return playerMetaCache;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, nationality, position
       FROM players`
    )
    .all() as Array<{
    id: number;
    name: string;
    nationality: string | null;
    position: string | null;
  }>;

  const map = new Map<number, PlayerMeta>();
  for (const row of rows) {
    const id = resolveCanonicalPlayerId(row.id);
    if (map.has(id)) continue;
    map.set(id, {
      id,
      name: row.name,
      nationality: row.nationality?.trim() || 'Bilinmiyor',
      position: row.position?.trim() || 'Bilinmiyor',
      clubCrest: null,
    });
  }
  playerMetaCache = map;
  return map;
}

function attachCrests(players: ConnectionsPlayerCard[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT t.crest AS crest
     FROM player_season_stats pss
     JOIN teams t ON t.id = pss.team_id
     JOIN seasons s ON s.id = pss.season_id
     WHERE pss.player_id = ?
     ORDER BY s.season_year DESC, COALESCE(pss.appearances, 0) DESC
     LIMIT 1`
  );
  for (const p of players) {
    const row = stmt.get(p.id) as { crest: string | null } | undefined;
    p.clubCrest = row?.crest ?? null;
  }
}

function pushCandidate(
  list: Candidate[],
  seen: Set<string>,
  c: Omit<Candidate, 'playerIds'> & { playerIds: number[] }
): void {
  const playerIds = uniqCanonical(c.playerIds).filter((id) => {
    const meta = loadPlayerMeta().get(id);
    return !!meta && meta.name.length > 1;
  });
  if (playerIds.length < CONNECTIONS_GROUP_SIZE) return;
  if (c.traits.length < 2) return;
  if (seen.has(c.signature)) return;
  seen.add(c.signature);
  list.push({ ...c, playerIds, rarity: playerIds.length });
}

function buildCandidates(): Candidate[] {
  if (candidateCache) return candidateCache;
  const db = getDb();
  const list: Candidate[] = [];
  const seen = new Set<string>();
  const elite = new Set(eliteClubKeys());

  // 1) Aynı kulüp sezonu + aynı milliyet
  const natClub = db
    .prepare(
      `SELECT pss.team_id, t.name AS team_name, s.season_year, p.nationality,
              GROUP_CONCAT(DISTINCT p.id) AS ids
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN teams t ON t.id = pss.team_id
       JOIN seasons s ON s.id = pss.season_id
       WHERE p.nationality IS NOT NULL AND length(trim(p.nationality)) > 1
         AND COALESCE(pss.appearances, 0) > 0
       GROUP BY pss.team_id, s.season_year, p.nationality
       HAVING COUNT(DISTINCT p.id) >= 4`
    )
    .all() as Array<{
    team_id: number;
    team_name: string;
    season_year: number;
    nationality: string;
    ids: string;
  }>;

  for (const row of natClub) {
    if (isYouthOrSecondary(row.team_name)) continue;
    const clubKey = canonicalClubKey(row.team_name);
    const season = seasonLabel(row.season_year);
    pushCandidate(list, seen, {
      signature: `natclub:${row.team_id}:${row.season_year}:${row.nationality}`,
      kind: 'club_season_nat',
      label: `${row.team_name} · ${season} · ${row.nationality}`,
      traits: [`Kulüp sezonu: ${row.team_name} ${season}`, `Milliyet: ${row.nationality}`],
      playerIds: row.ids.split(',').map((x) => Number(x)),
      rarity: 0,
      elite: !!(clubKey && elite.has(clubKey)),
      clubAxis: clubAxisKey(row.team_id, row.team_name),
      natAxis: natAxisKey(row.nationality),
    });
  }

  // 2) Aynı kulüp sezonu + aynı mevki ailesi
  const posClub = db
    .prepare(
      `SELECT pss.team_id, t.name AS team_name, s.season_year, p.position,
              GROUP_CONCAT(DISTINCT p.id) AS ids
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN teams t ON t.id = pss.team_id
       JOIN seasons s ON s.id = pss.season_id
       WHERE p.position IS NOT NULL AND length(trim(p.position)) > 1
         AND COALESCE(pss.appearances, 0) > 0
       GROUP BY pss.team_id, s.season_year, p.position
       HAVING COUNT(DISTINCT p.id) >= 4`
    )
    .all() as Array<{
    team_id: number;
    team_name: string;
    season_year: number;
    position: string;
    ids: string;
  }>;

  const posBucket = new Map<string, { team: string; year: number; family: string; ids: number[]; elite: boolean }>();
  for (const row of posClub) {
    if (isYouthOrSecondary(row.team_name)) continue;
    const family = positionFamily(row.position);
    if (!family) continue;
    const key = `${row.team_id}:${row.season_year}:${family}`;
    const clubKey = canonicalClubKey(row.team_name);
    const existing = posBucket.get(key);
    const ids = row.ids.split(',').map((x) => Number(x));
    if (existing) {
      existing.ids.push(...ids);
    } else {
      posBucket.set(key, {
        team: row.team_name,
        year: row.season_year,
        family,
        ids,
        elite: !!(clubKey && elite.has(clubKey)),
      });
    }
  }
  for (const [sig, bucket] of posBucket) {
    const season = seasonLabel(bucket.year);
    const teamId = Number(sig.split(':')[0]);
    pushCandidate(list, seen, {
      signature: `posclub:${sig}`,
      kind: 'club_season_pos',
      label: `${bucket.team} · ${season} · ${bucket.family}`,
      traits: [`Kulüp sezonu: ${bucket.team} ${season}`, `Mevki: ${bucket.family}`],
      playerIds: bucket.ids,
      rarity: 0,
      elite: bucket.elite,
      clubAxis: clubAxisKey(teamId, bucket.team),
      natAxis: null,
    });
  }

  // 3) Aynı CL sezonu + aynı milliyet
  const clNat = db
    .prepare(
      `SELECT s.season_year, p.nationality, GROUP_CONCAT(DISTINCT p.id) AS ids
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN seasons s ON s.id = pss.season_id
       JOIN competitions c ON c.id = pss.competition_id
       WHERE c.code = 'CL'
         AND p.nationality IS NOT NULL AND length(trim(p.nationality)) > 1
         AND COALESCE(pss.appearances, 0) > 0
       GROUP BY s.season_year, p.nationality
       HAVING COUNT(DISTINCT p.id) BETWEEN 4 AND 80`
    )
    .all() as Array<{ season_year: number; nationality: string; ids: string }>;

  for (const row of clNat) {
    const season = seasonLabel(row.season_year);
    pushCandidate(list, seen, {
      signature: `clnat:${row.season_year}:${row.nationality}`,
      kind: 'cl_season_nat',
      label: `ŞL ${season} · ${row.nationality}`,
      traits: [`Şampiyonlar Ligi sezonu: ${season}`, `Milliyet: ${row.nationality}`],
      playerIds: row.ids.split(',').map((x) => Number(x)),
      rarity: 0,
      elite: true,
      clubAxis: null,
      natAxis: natAxisKey(row.nationality),
    });
  }

  // 4) Aynı CL kulüp sezonu + aynı milliyet (daha spesifik)
  const clClubNat = db
    .prepare(
      `SELECT pss.team_id, t.name AS team_name, s.season_year, p.nationality,
              GROUP_CONCAT(DISTINCT p.id) AS ids
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN teams t ON t.id = pss.team_id
       JOIN seasons s ON s.id = pss.season_id
       JOIN competitions c ON c.id = pss.competition_id
       WHERE c.code = 'CL'
         AND p.nationality IS NOT NULL AND length(trim(p.nationality)) > 1
         AND COALESCE(pss.appearances, 0) > 0
       GROUP BY pss.team_id, s.season_year, p.nationality
       HAVING COUNT(DISTINCT p.id) >= 4`
    )
    .all() as Array<{
    team_id: number;
    team_name: string;
    season_year: number;
    nationality: string;
    ids: string;
  }>;

  for (const row of clClubNat) {
    if (isYouthOrSecondary(row.team_name)) continue;
    const clubKey = canonicalClubKey(row.team_name);
    const season = seasonLabel(row.season_year);
    pushCandidate(list, seen, {
      signature: `clclubnat:${row.team_id}:${row.season_year}:${row.nationality}`,
      kind: 'cl_club_nat',
      label: `ŞL ${row.team_name} · ${season} · ${row.nationality}`,
      traits: [
        `ŞL kulüp sezonu: ${row.team_name} ${season}`,
        `Milliyet: ${row.nationality}`,
      ],
      playerIds: row.ids.split(',').map((x) => Number(x)),
      rarity: 0,
      elite: !!(clubKey && elite.has(clubKey)),
      clubAxis: clubAxisKey(row.team_id, row.team_name),
      natAxis: natAxisKey(row.nationality),
    });
  }

  // 5) Kariyer boyunca aynı kulüp + aynı milliyet (sezon bağımsız)
  const careerNat = db
    .prepare(
      `SELECT pss.team_id, t.name AS team_name, p.nationality,
              GROUP_CONCAT(DISTINCT p.id) AS ids
       FROM player_season_stats pss
       JOIN players p ON p.id = pss.player_id
       JOIN teams t ON t.id = pss.team_id
       WHERE p.nationality IS NOT NULL AND length(trim(p.nationality)) > 1
         AND COALESCE(pss.appearances, 0) > 0
       GROUP BY pss.team_id, p.nationality
       HAVING COUNT(DISTINCT p.id) >= 4 AND COUNT(DISTINCT p.id) <= 40`
    )
    .all() as Array<{
    team_id: number;
    team_name: string;
    nationality: string;
    ids: string;
  }>;

  for (const row of careerNat) {
    if (isYouthOrSecondary(row.team_name)) continue;
    const clubKey = canonicalClubKey(row.team_name);
    pushCandidate(list, seen, {
      signature: `careernat:${row.team_id}:${row.nationality}`,
      kind: 'career_club_nat',
      label: `${row.team_name} kariyeri · ${row.nationality}`,
      traits: [`Kulüp (kariyer): ${row.team_name}`, `Milliyet: ${row.nationality}`],
      playerIds: row.ids.split(',').map((x) => Number(x)),
      rarity: 0,
      elite: !!(clubKey && elite.has(clubKey)),
      clubAxis: clubAxisKey(row.team_id, row.team_name),
      natAxis: natAxisKey(row.nationality),
    });
  }

  candidateCache = list;
  return list;
}

function ensureVisibility(): Map<number, number> {
  if (visibilityCache) return visibilityCache;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT player_id,
              COALESCE(SUM(appearances), 0) AS apps,
              COALESCE(MAX(market_value), 0) AS mv
       FROM player_season_stats
       GROUP BY player_id`
    )
    .all() as Array<{ player_id: number; apps: number; mv: number }>;
  const map = new Map<number, number>();
  for (const row of rows) {
    const id = resolveCanonicalPlayerId(row.player_id);
    const score = row.apps * 10 + Math.min(row.mv, 80_000_000) / 1_000_000;
    map.set(id, Math.max(map.get(id) ?? 0, score));
  }
  visibilityCache = map;
  return map;
}

function pickBestPlayers(ids: number[], rnd: () => number): number[] {
  const vis = ensureVisibility();
  const scored = ids.map((id) => ({ id, score: vis.get(id) ?? 0 }));
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const band = Math.min(Math.max(CONNECTIONS_GROUP_SIZE * 3, 8), scored.length);
  const top = scored.slice(0, band).map((s) => s.id);
  shuffleInPlace(top, rnd);
  return top.slice(0, CONNECTIONS_GROUP_SIZE);
}

function filterByDifficulty(candidates: Candidate[], difficulty: DifficultyId): Candidate[] {
  if (difficulty === 'easy') {
    return candidates.filter(
      (c) =>
        c.elite &&
        c.rarity >= 6 &&
        c.kind !== 'cl_season_nat' &&
        (c.kind === 'club_season_nat' ||
          c.kind === 'club_season_pos' ||
          c.kind === 'cl_club_nat' ||
          c.kind === 'career_club_nat')
    );
  }
  if (difficulty === 'medium') {
    return candidates.filter(
      (c) =>
        c.rarity >= 5 &&
        c.rarity <= 60 &&
        (c.elite || c.kind === 'cl_club_nat' || c.kind === 'club_season_nat')
    );
  }
  return candidates.filter((c) => c.rarity >= 4 && c.rarity <= 28);
}

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

function overlapCount(a: number[], b: number[]): number {
  const setB = new Set(b);
  return a.filter((id) => setB.has(id)).length;
}

function toGroupPublic(
  group: ConnectionsGroup,
  players: ConnectionsPlayerCard[]
): ConnectionsGroupPublic {
  const byId = new Map(players.map((p) => [p.id, p]));
  return {
    id: group.id,
    label: group.label,
    traits: group.traits,
    color: group.color,
    playerIds: group.playerIds,
    players: group.playerIds.map((id) => ({
      id,
      name: byId.get(id)?.name ?? `#${id}`,
    })),
  };
}

function assemblePuzzle(
  difficulty: DifficultyId,
  date: string,
  session: number
): ConnectionsPuzzle {
  const all = buildCandidates();
  let pool = filterByDifficulty(all, difficulty);
  if (pool.length < CONNECTIONS_GROUP_COUNT) {
    pool = filterByDifficulty(all, 'medium');
  }
  if (pool.length < CONNECTIONS_GROUP_COUNT) {
    pool = all.filter((c) => c.rarity >= 4);
  }
  if (pool.length < CONNECTIONS_GROUP_COUNT) {
    throw new Error('No eligible Connections boards for this difficulty');
  }

  const seed = hashSeed(`${date}:${buildPuzzleKey('connections', difficulty, session)}`);
  const rnd = mulberry32(seed);
  const ordered = [...pool];
  shuffleInPlace(ordered, rnd);

  // Try multiple starts for a valid disjoint board
  const startOffset = getDailyIndex(date, buildPuzzleKey('connections-start', difficulty, session), ordered.length);
  for (let attempt = 0; attempt < Math.min(80, ordered.length); attempt++) {
    const start = (startOffset + attempt) % ordered.length;
    const used = new Set<number>();
    const picked: Array<{ candidate: Candidate; playerIds: number[] }> = [];
    const kindUsed = new Set<string>();
    const clubsUsed = new Set<string>();
    const natsUsed = new Set<string>();

    for (let i = 0; i < ordered.length && picked.length < CONNECTIONS_GROUP_COUNT; i++) {
      const candidate = ordered[(start + i) % ordered.length]!;
      // Prefer variety of connection kinds
      if (kindUsed.has(candidate.kind) && picked.length < 3 && rnd() < 0.7) continue;
      if (candidate.clubAxis && clubsUsed.has(candidate.clubAxis)) continue;
      if (candidate.natAxis && natsUsed.has(candidate.natAxis)) continue;

      const available = candidate.playerIds.filter((id) => !used.has(id));
      if (available.length < CONNECTIONS_GROUP_SIZE) continue;

      const localRnd = mulberry32(seed ^ hashSeed(candidate.signature) ^ attempt);
      const playerIds = pickBestPlayers(available, localRnd);

      picked.push({ candidate, playerIds });
      for (const id of playerIds) used.add(id);
      kindUsed.add(candidate.kind);
      if (candidate.clubAxis) clubsUsed.add(candidate.clubAxis);
      if (candidate.natAxis) natsUsed.add(candidate.natAxis);
    }

    if (picked.length < CONNECTIONS_GROUP_COUNT) continue;

    // Larger pools feel easier → yellow first; rarest → purple
    picked.sort((a, b) => b.candidate.rarity - a.candidate.rarity);
    const groups: ConnectionsGroup[] = picked.map((p, idx) => ({
      id: `g${idx}`,
      label: p.candidate.label,
      traits: p.candidate.traits,
      color: CONNECTIONS_COLORS[idx] ?? 'yellow',
      playerIds: p.playerIds,
    }));

    const meta = loadPlayerMeta();
    const allIds = groups.flatMap((g) => g.playerIds);
    if (new Set(allIds).size !== CONNECTIONS_BOARD) continue;

    const players: ConnectionsPlayerCard[] = allIds.map((id) => {
      const m = meta.get(id)!;
      return {
        id: m.id,
        name: m.name,
        nationality: m.nationality,
        position: m.position,
        clubCrest: null,
      };
    });
    attachCrests(players);

    const board = [...allIds];
    shuffleInPlace(board, rnd);

    return { groups, players, board };
  }

  throw new Error('Could not assemble a Connections board');
}

export function createConnectionsPuzzle(
  difficulty: DifficultyId,
  date: string,
  session: number
): ConnectionsPuzzle {
  const key = cacheKey(difficulty, date, session);
  const cached = puzzleCache.get(key);
  if (cached) return cached;

  const stored = getStoredPuzzle<ConnectionsPuzzle>(
    'connections',
    'v2',
    difficulty,
    date,
    session
  );
  if (stored?.groups?.length === CONNECTIONS_GROUP_COUNT && stored.board?.length === CONNECTIONS_BOARD) {
    puzzleCache.set(key, stored);
    return stored;
  }

  const puzzle = assemblePuzzle(difficulty, date, session);
  savePuzzle('connections', 'v2', difficulty, date, session, puzzle);
  puzzleCache.set(key, puzzle);
  return puzzle;
}

export function toPublicConnectionsPuzzle(
  puzzle: ConnectionsPuzzle,
  date: string,
  session: number,
  difficulty: DifficultyId
): ConnectionsPuzzlePublic {
  return {
    date,
    session,
    difficulty,
    mistakes: CONNECTIONS_MISTAKES,
    players: puzzle.players,
    board: puzzle.board,
  };
}

export function guessConnections(params: {
  difficulty: DifficultyId;
  date: string;
  session: number;
  playerIds: number[];
  solvedGroupIds: string[];
  mistakesLeft: number;
}): ConnectionsGuessResult {
  const { difficulty, date, session, playerIds, solvedGroupIds, mistakesLeft } = params;

  if (playerIds.length !== CONNECTIONS_GROUP_SIZE) {
    throw new Error('Guess must contain exactly 4 players');
  }
  if (new Set(playerIds).size !== CONNECTIONS_GROUP_SIZE) {
    throw new Error('Duplicate players in guess');
  }
  if (mistakesLeft <= 0) {
    throw new Error('No mistakes left');
  }

  const puzzle = createConnectionsPuzzle(difficulty, date, session);
  const solved = new Set(solvedGroupIds);
  const remaining = puzzle.groups.filter((g) => !solved.has(g.id));

  const hit = remaining.find((g) => setsEqual(g.playerIds, playerIds));
  if (hit) {
    const nextSolvedCount = solved.size + 1;
    const won = nextSolvedCount >= CONNECTIONS_GROUP_COUNT;
    return {
      correct: true,
      oneAway: false,
      mistakesLeft,
      solvedGroup: toGroupPublic(hit, puzzle.players),
      won,
      lost: false,
    };
  }

  const oneAway = remaining.some(
    (g) => overlapCount(playerIds, g.playerIds) === CONNECTIONS_GROUP_SIZE - 1
  );
  const nextMistakes = mistakesLeft - 1;
  const lost = nextMistakes <= 0;

  return {
    correct: false,
    oneAway,
    mistakesLeft: nextMistakes,
    solvedGroup: null,
    won: false,
    lost,
    remainingGroups: lost
      ? remaining.map((g) => toGroupPublic(g, puzzle.players))
      : undefined,
  };
}

export function revealConnections(
  difficulty: DifficultyId,
  date: string,
  session: number,
  solvedGroupIds: string[] = []
): { groups: ConnectionsGroupPublic[] } {
  const puzzle = createConnectionsPuzzle(difficulty, date, session);
  const solved = new Set(solvedGroupIds);
  const remaining = puzzle.groups.filter((g) => !solved.has(g.id));
  return {
    groups: remaining.map((g) => toGroupPublic(g, puzzle.players)),
  };
}
