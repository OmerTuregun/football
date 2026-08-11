/**
 * StatPal v2 Soccer API — Adım 0 keşif (max ~30 istek).
 * Usage: npm run explore-statpal
 */
import { getStatPalAccessKey } from '../config';

const BASE = 'https://statpal.io/api/v2/soccer';
const MAX_REQUESTS = 30;

let requestCount = 0;
const requestLog: Array<{ n: number; method: string; url: string; status: number }> = [];

interface StatPalLeague {
  id: string;
  country: string;
  name: string;
  season?: string;
  date_start?: string;
  date_end?: string;
}

/** Priority list → search rules (name + country hints). */
const TARGET_LEAGUES: Array<{
  label: string;
  match: (l: StatPalLeague) => boolean;
}> = [
  {
    label: 'Champions League',
    match: (l) =>
      /champions league/i.test(l.name) &&
      !/women|youth|u19|u21|qualifying/i.test(l.name),
  },
  {
    label: 'Premier League',
    match: (l) =>
      /^premier league$/i.test(l.name.trim()) &&
      /england|english|uk|great britain/i.test(l.country),
  },
  {
    label: 'La Liga',
    match: (l) =>
      (/^primera$/i.test(l.name.trim()) || /^la liga$/i.test(l.name.trim())) &&
      /spain|espa/i.test(l.country),
  },
  {
    label: 'Süper Lig',
    match: (l) =>
      (/super lig|süper lig|superlig/i.test(l.name) || /super lig/i.test(l.name)) &&
      /turkey|türkiye|turkiye/i.test(l.country),
  },
  {
    label: 'Bundesliga',
    match: (l) =>
      /^bundesliga$/i.test(l.name.trim()) &&
      /germany|deutsch/i.test(l.country) &&
      !/2\.|second|women|youth/i.test(l.name),
  },
  {
    label: 'Serie A',
    match: (l) =>
      /^serie a$/i.test(l.name.trim()) &&
      /italy|italia/i.test(l.country),
  },
  {
    label: 'Ligue 1',
    match: (l) =>
      /^ligue 1$/i.test(l.name.trim()) &&
      /france/i.test(l.country),
  },
  {
    label: 'Europa League',
    match: (l) =>
      /europa league/i.test(l.name) &&
      !/conference|women|youth/i.test(l.name),
  },
  {
    label: 'Primeira Liga',
    match: (l) =>
      (/portuguese liga|primeira liga/i.test(l.name)) && /portugal/i.test(l.country),
  },
  {
    label: 'Eredivisie',
    match: (l) =>
      /^eredivisie$/i.test(l.name.trim()) && /netherlands|holland|nederland/i.test(l.country),
  },
  {
    label: 'Conference League',
    match: (l) => /conference league|europa conference/i.test(l.name),
  },
];

async function apiGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`Request budget exhausted (${MAX_REQUESTS})`);
  }

  const qs = new URLSearchParams({ ...params, access_key: getStatPalAccessKey() });
  const url = `${BASE}${path}?${qs}`;
  requestCount += 1;
  const n = requestCount;

  console.log(`\n[${n}/${MAX_REQUESTS}] GET ${path}${Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : ''}`);

  const res = await fetch(url);
  requestLog.push({ n, method: 'GET', url: `${BASE}${path}`, status: res.status });
  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    console.log(`  HTTP ${res.status}:`, JSON.stringify(json).slice(0, 400));
  } else {
    console.log(`  HTTP ${res.status} OK`);
  }

  return json;
}

/** user-request-count lives at /api/ not /api/v2/soccer/ */
async function getUserRequestCount(): Promise<unknown> {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`Request budget exhausted (${MAX_REQUESTS})`);
  }
  const qs = new URLSearchParams({ access_key: getStatPalAccessKey() });
  const url = `https://statpal.io/api/user-request-count?${qs}`;
  requestCount += 1;
  const n = requestCount;
  console.log(`\n[${n}/${MAX_REQUESTS}] GET /user-request-count (does NOT count toward quota per docs)`);
  const res = await fetch(url);
  requestLog.push({ n, method: 'GET', url: 'https://statpal.io/api/user-request-count', status: res.status });
  const json = await res.json();
  console.log('  ', JSON.stringify(json, null, 2));
  return json;
}

function normalizeSeasonNames(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((s) => (typeof s === 'object' && s && 'name' in s ? String((s as { name: string }).name) : String(s)))
      .filter(Boolean);
  }
  if (typeof raw === 'object' && raw && 'name' in raw) {
    return [String((raw as { name: string }).name)];
  }
  return [];
}

function lastSeasons(names: string[], count = 3): string[] {
  const unique = [...new Set(names)];
  unique.sort((a, b) => {
    const ya = parseInt(a.match(/\d{4}/)?.[0] ?? '0', 10);
    const yb = parseInt(b.match(/\d{4}/)?.[0] ?? '0', 10);
    return yb - ya;
  });
  return unique.slice(0, count);
}

function collectMatches(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return [];
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.matches)) return obj.matches;
  if (obj.matches && typeof obj.matches === 'object') {
    const m = obj.matches as Record<string, unknown>;
    if (Array.isArray(m.match)) return m.match;
    return [obj.matches];
  }
  if (Array.isArray(obj.match)) return obj.match;
  if (Array.isArray(obj.week)) {
    return obj.week.flatMap((w) => collectMatches(w));
  }
  if (Array.isArray(obj.tournament)) {
    return obj.tournament.flatMap((t) => collectMatches(t));
  }
  if (obj.tournament && typeof obj.tournament === 'object') {
    return collectMatches(obj.tournament);
  }
  return [];
}

function analyzeMatchStatsPayload(json: unknown): {
  matchCount: number;
  hasLineups: boolean;
  hasEvents: boolean;
  hasPlayerStats: boolean;
  sampleMatchIds: string[];
  sampleLineupPlayers: string[];
} {
  const root = json as Record<string, unknown>;
  const ms = (root['match-stats'] ?? root.match_stats ?? root) as Record<string, unknown>;
  const matches = collectMatches(ms);
  let hasLineups = false;
  let hasEvents = false;
  let hasPlayerStats = false;
  const sampleMatchIds: string[] = [];
  const sampleLineupPlayers: string[] = [];

  for (const m of matches.slice(0, 5)) {
    if (!m || typeof m !== 'object') continue;
    const match = m as Record<string, unknown>;
    const id = String(match.main_id ?? match.id ?? '');
    if (id) sampleMatchIds.push(id);

    const lineups = match.lineups as Record<string, unknown> | undefined;
    if (lineups) {
      hasLineups = true;
      for (const side of ['home', 'away']) {
        const team = lineups[side] as Record<string, unknown> | undefined;
        const players = team?.player;
        if (Array.isArray(players)) {
          for (const p of players.slice(0, 3)) {
            if (p && typeof p === 'object' && 'name' in p) {
              sampleLineupPlayers.push(String((p as { name: string }).name));
            }
          }
        }
      }
    }

    if (match.events || match.event_summary) hasEvents = true;
    if (match.player_stats) hasPlayerStats = true;
  }

  return {
    matchCount: matches.length,
    hasLineups,
    hasEvents,
    hasPlayerStats,
    sampleMatchIds,
    sampleLineupPlayers,
  };
}

async function main(): Promise<void> {
  getStatPalAccessKey();
  console.log('StatPal Adım 0 — keşif (budget:', MAX_REQUESTS, 'requests)\n');

  // 4) Usage monitoring first (free per docs)
  console.log('=== 4) /user-request-count ===');
  await getUserRequestCount();

  // 1) Leagues
  console.log('\n=== 1) /soccer/leagues — league ID mapping ===');
  const leaguesRaw = await apiGet('/leagues');
  const leagueList: StatPalLeague[] =
    ((leaguesRaw as { leagues?: { league?: StatPalLeague[] } }).leagues?.league) ?? [];

  const mapping: Array<{
    label: string;
    league: StatPalLeague | null;
    candidates: StatPalLeague[];
  }> = [];

  for (const target of TARGET_LEAGUES) {
    const candidates = leagueList.filter(target.match);
    mapping.push({
      label: target.label,
      league: candidates[0] ?? null,
      candidates,
    });
  }

  console.log('\n--- League mapping ---');
  for (const row of mapping) {
    if (row.league) {
      console.log(
        `${row.label}: id=${row.league.id} country=${row.league.country} name="${row.league.name}" current_season=${row.league.season ?? 'n/a'}`
      );
    } else {
      console.log(`${row.label}: NOT FOUND (${row.candidates.length} partial candidates)`);
      row.candidates.slice(0, 3).forEach((c) =>
        console.log(`  candidate: id=${c.id} country=${c.country} name="${c.name}"`)
      );
    }
  }

  // 2) Seasons (bulk endpoint — filter client-side)
  console.log('\n=== 2) /soccer/leagues/seasons — last 3 seasons per league ===');
  const seasonsRaw = await apiGet('/leagues/seasons');
  const seasonLeagues: Array<{
    id: string;
    country: string;
    name: string;
    matches?: { season?: unknown };
    standings?: { season?: unknown };
  }> = ((seasonsRaw as { seasons?: { league?: typeof seasonLeagues } }).seasons?.league) ?? [];

  for (const row of mapping) {
    if (!row.league) continue;
    const entry = seasonLeagues.find((l) => l.id === row.league!.id);
    if (!entry) {
      console.log(`${row.label}: no seasons entry for id ${row.league.id}`);
      continue;
    }
    const matchSeasons = normalizeSeasonNames(entry.matches?.season);
    const standingSeasons = normalizeSeasonNames(entry.standings?.season);
    const combined = lastSeasons([...matchSeasons, ...standingSeasons], 3);
    console.log(
      `${row.label} (id=${row.league.id}): matches=[${matchSeasons.slice(-5).join(', ')}] standings=[${standingSeasons.slice(-5).join(', ')}] → last3=[${combined.join(', ')}]`
    );
  }

  // 3) Historical matches/stats test — CL + PL, late season 2024
  console.log('\n=== 3) Historical /matches/stats (lineup + events test) ===');
  const historicalDates = ['20.04.2024', '01.06.2024', '15.03.2024'];
  const testLeagues = mapping.filter((m) => m.league && ['Champions League', 'Premier League'].includes(m.label));

  for (const row of testLeagues) {
    const leagueId = row.league!.id;
    for (const date of historicalDates) {
      if (requestCount >= MAX_REQUESTS - 2) break;
      try {
        const stats = await apiGet(`/leagues/${leagueId}/matches/stats`, { date });
        const analysis = analyzeMatchStatsPayload(stats);
        console.log(
          `  ${row.label} date=${date}: matches=${analysis.matchCount} lineups=${analysis.hasLineups} events=${analysis.hasEvents} player_stats=${analysis.hasPlayerStats}`
        );
        if (analysis.sampleMatchIds.length) {
          console.log(`    match ids: ${analysis.sampleMatchIds.join(', ')}`);
        }
        if (analysis.sampleLineupPlayers.length) {
          console.log(`    lineup sample: ${analysis.sampleLineupPlayers.join(', ')}`);
        }
        if (analysis.matchCount > 0) {
          console.log('  Response snippet:', JSON.stringify(stats).slice(0, 1200));
          break; // one successful date enough per league
        }
      } catch (err) {
        console.log(`  ${row.label} date=${date}: error`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Final usage check
  if (requestCount < MAX_REQUESTS) {
    console.log('\n=== Final /user-request-count ===');
    await getUserRequestCount();
  }

  console.log('\n=== REQUEST LOG ===');
  for (const r of requestLog) {
    console.log(`  #${r.n} HTTP ${r.status} ${r.url}`);
  }
  console.log(`\nTotal API calls logged: ${requestCount} (budget ${MAX_REQUESTS})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
