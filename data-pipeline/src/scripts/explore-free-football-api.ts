/**
 * One-shot exploration of RapidAPI "Free API Live Football Data" (Smart API / Creativesdev).
 * Discovers player profile + goals/assists JSON shapes. Hard-capped request budget.
 *
 * Usage (from data-pipeline/):
 *   npm run explore-free-api
 *
 * Requires RAPIDAPI_KEY in root .env or data-pipeline/.env
 *
 * Playground endpoints of interest (from RapidAPI route list):
 *   /football-players-search              ?search=
 *   /football-get-player-detail           ?playerid=   (Get Player Detail by Player ID)
 *   /football-get-list-player             ?teamid=     (Get Players List All by Team ID)
 *   /football-leagues-search              ?search=
 *   /football-league-all-seasons          ?leagueid=
 *   /football-get-top-players-by-goals    ?leagueid=&seasonid=
 *   /football-get-top-players-by-assists  ?leagueid=&seasonid=
 *   /football-get-top-players-by-rating   ?leagueid=&seasonid=
 *   /football-get-trophies-all-seasons    ?playerid=
 *   /football-get-rounds-players          (round-scoped roster)
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const BASE_URL = 'https://free-api-live-football-data.p.rapidapi.com';
const HOST = 'free-api-live-football-data.p.rapidapi.com';
const MAX_REQUESTS = 10;
const MESSI_ID = '30981';
const MESSI_TEAM_ID = '960720';

let requestCount = 0;

function getKey(): string {
  const key = process.env.RAPIDAPI_KEY;
  if (!key || key === 'your_rapidapi_key_here') {
    throw new Error(
      'RAPIDAPI_KEY is not set. Add your RapidAPI key to root .env, then re-run: npm run explore-free-api'
    );
  }
  return key;
}

function logRateLimitHeaders(res: Response): void {
  const interesting: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith('x-ratelimit') || k.includes('rate') || k === 'retry-after') {
      interesting[key] = value;
    }
  });
  console.log(
    Object.keys(interesting).length === 0
      ? '  [headers] no x-ratelimit-* headers'
      : `  [headers] ${JSON.stringify(interesting)}`
  );
}

function isErrorPayload(json: unknown): boolean {
  if (!json || typeof json !== 'object') return true;
  const obj = json as Record<string, unknown>;
  if (typeof obj.message === 'string' && /not subscribed|invalid|forbidden|missing|required/i.test(obj.message)) {
    return true;
  }
  if (obj.status === 'error' || obj.status === false) return true;
  return false;
}

function looksUseful(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  if (isErrorPayload(json)) return false;
  const obj = json as Record<string, unknown>;
  if (obj.status === 'success') return true;
  if (obj.response !== undefined) return true;
  return JSON.stringify(json).length > 80;
}

async function probe(
  label: string,
  route: string,
  params: Record<string, string | number>
): Promise<unknown> {
  if (requestCount >= MAX_REQUESTS) {
    console.log(`\n[skip] ${label} — budget exhausted (${MAX_REQUESTS})`);
    return null;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    qs.set(k, String(v));
  }
  const url = `${BASE_URL}/${route}?${qs}`;
  requestCount += 1;

  console.log(`\n========== [${requestCount}/${MAX_REQUESTS}] ${label} ==========`);
  console.log(`GET /${route}?${qs}`);

  const res = await fetch(url, {
    headers: {
      'x-rapidapi-key': getKey(),
      'x-rapidapi-host': HOST,
      Accept: 'application/json',
    },
  });

  logRateLimitHeaders(res);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`  HTTP ${res.status} (non-JSON): ${text.slice(0, 400)}`);
    return null;
  }

  console.log(`  HTTP ${res.status}`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

/** Try param name variants until one returns useful JSON; counts each attempt. */
async function probeVariants(
  label: string,
  route: string,
  variants: Array<Record<string, string | number>>
): Promise<unknown> {
  for (const params of variants) {
    const json = await probe(`${label} ${JSON.stringify(params)}`, route, params);
    if (looksUseful(json)) return json;
  }
  return null;
}

function findStatLikePaths(value: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (value === null || value === undefined) return hits;
  if (typeof value !== 'object') {
    const leaf = path.split('.').pop() ?? '';
    if (/goal|assist|appear|minute|match|stat|score|rating|played/i.test(leaf) || /goal|assist/i.test(path)) {
      hits.push(`${path}=${JSON.stringify(value)}`);
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((item, i) => hits.push(...findStatLikePaths(item, `${path}[${i}]`)));
    return hits;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    hits.push(...findStatLikePaths(v, path ? `${path}.${k}` : k));
  }
  return hits;
}

function firstId(json: unknown, keys: string[]): string | undefined {
  const raw = JSON.stringify(json ?? {});
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`);
    const m = raw.match(re);
    if (m) return m[1];
  }
  return undefined;
}

async function main(): Promise<void> {
  getKey();
  console.log('Exploring Free API Live Football Data');
  console.log(`Budget=${MAX_REQUESTS}  seed playerId=${MESSI_ID} teamId=${MESSI_TEAM_ID}`);

  // 1) Search — known working; id/name/team only (no stats)
  const search = await probe('players-search', 'football-players-search', { search: 'messi' });
  let playerId = MESSI_ID;
  let teamId = MESSI_TEAM_ID;
  if (looksUseful(search)) {
    playerId = firstId(search, ['id']) ?? playerId;
    teamId = firstId(search, ['teamId', 'teamid']) ?? teamId;
    console.log(`\n[note] using playerId=${playerId} teamId=${teamId}`);
    console.log('[note] search has no goals/assists — only identity fields');
  }

  // 2) Player detail / profile
  const detail = await probeVariants('player-detail', 'football-get-player-detail', [
    { playerid: playerId },
    { playerId },
    { id: playerId },
  ]);
  if (detail) {
    console.log('\n[summary] player-detail stat-like paths:');
    console.log(findStatLikePaths(detail).slice(0, 50).join('\n') || '(none)');
  }

  // 3) Squad list by team
  const list = await probeVariants('list-player', 'football-get-list-player', [
    { teamid: teamId },
    { teamId },
    { id: teamId },
  ]);
  if (list) {
    console.log('\n[summary] list-player stat-like paths:');
    console.log(findStatLikePaths(list).slice(0, 50).join('\n') || '(none)');
  }

  // 4) Resolve a league + season for top scorers
  const leagueSearch = await probe('leagues-search', 'football-leagues-search', {
    search: 'champions league',
  });
  const leagueId = looksUseful(leagueSearch)
    ? firstId(leagueSearch, ['id', 'leagueId', 'leagueid'])
    : undefined;
  console.log(`[note] leagueId=${leagueId ?? 'n/a'}`);

  let seasonId: string | undefined;
  if (leagueId && requestCount < MAX_REQUESTS) {
    const seasons = await probeVariants('league-all-seasons', 'football-league-all-seasons', [
      { leagueid: leagueId },
      { leagueId },
      { id: leagueId },
    ]);
    if (seasons) {
      seasonId = firstId(seasons, ['seasonId', 'seasonid', 'id']);
      console.log(`[note] seasonId candidate=${seasonId ?? 'n/a'}`);
      console.log('[summary] seasons sample paths:', findStatLikePaths(seasons).slice(0, 20).join(', ') || '(n/a)');
    }
  }

  // 5) Top players by goals / assists (season leaderboard — strong enrichment candidate)
  if (leagueId && seasonId) {
    const topGoals = await probeVariants('top-goals', 'football-get-top-players-by-goals', [
      { leagueid: leagueId, seasonid: seasonId },
      { leagueId, seasonId },
      { id: leagueId, season: seasonId },
    ]);
    if (topGoals) {
      console.log('\n[summary] top-goals stat-like paths:');
      console.log(findStatLikePaths(topGoals).slice(0, 50).join('\n') || '(none)');
    }

    if (requestCount < MAX_REQUESTS) {
      const topAssists = await probeVariants('top-assists', 'football-get-top-players-by-assists', [
        { leagueid: leagueId, seasonid: seasonId },
        { leagueId, seasonId },
      ]);
      if (topAssists) {
        console.log('\n[summary] top-assists stat-like paths:');
        console.log(findStatLikePaths(topAssists).slice(0, 50).join('\n') || '(none)');
      }
    }
  }

  // 6) Trophies (career) if budget left — may not include season goals
  if (requestCount < MAX_REQUESTS) {
    const trophies = await probeVariants('trophies', 'football-get-trophies-all-seasons', [
      { playerid: playerId },
      { playerId },
    ]);
    if (trophies) {
      console.log('\n[summary] trophies stat-like:', findStatLikePaths(trophies).slice(0, 20).join('\n') || '(none)');
    }
  }

  console.log(`\n========== DONE — ${requestCount}/${MAX_REQUESTS} requests used ==========`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
