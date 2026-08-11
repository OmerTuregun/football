import { closeDb, getDb, runMigrations } from '../db/client';
import { getApiFootballLeagueId } from '../config/apiFootballMapping';
import {
  getPlayersByTeamAndSeason,
  getRequestsUsedThisSession,
  getTeamsByLeagueAndSeason,
  RateLimitExceededError,
  type ApiFootballPlayerEntry,
  type ApiFootballTeam,
} from '../fetch/apiFootballClient';
import { parseArgs } from '../utils';
import { normalizeForSearch } from '../utils/normalizeSearch';

interface DbTeam {
  id: number;
  name: string;
  short_name: string | null;
}

interface DbPlayerRow {
  player_id: number;
  stats_id: number;
  name: string;
  name_search: string | null;
}

interface FetchState {
  status: string;
  last_page_fetched: number;
}

function getFetchState(competitionCode: string, seasonYear: number): FetchState | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT status, last_page_fetched FROM api_football_fetch_state
       WHERE competition_code = ? AND season_year = ?`
    )
    .get(competitionCode, seasonYear) as FetchState | undefined;
}

function upsertFetchState(
  competitionCode: string,
  seasonYear: number,
  status: 'pending' | 'done' | 'partial',
  lastTeamIndex: number
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO api_football_fetch_state (competition_code, season_year, status, last_page_fetched, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(competition_code, season_year) DO UPDATE SET
       status = excluded.status,
       last_page_fetched = excluded.last_page_fetched,
       updated_at = datetime('now')`
  ).run(competitionCode, seasonYear, status, lastTeamIndex);
}

function getSeasonContext(
  competitionCode: string,
  seasonYear: number
): { seasonId: number; competitionId: number } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id AS season_id, c.id AS competition_id
       FROM seasons s
       JOIN competitions c ON c.id = s.competition_id
       WHERE c.code = ? AND s.season_year = ?`
    )
    .get(competitionCode, seasonYear) as { season_id: number; competition_id: number } | undefined;

  if (!row) return null;
  return { seasonId: row.season_id, competitionId: row.competition_id };
}

function getDbTeams(seasonId: number, competitionId: number): DbTeam[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT DISTINCT t.id, t.name, t.short_name
       FROM teams t
       JOIN player_season_stats pss ON pss.team_id = t.id
       WHERE pss.season_id = ? AND pss.competition_id = ?
       ORDER BY t.id`
    )
    .all(seasonId, competitionId) as DbTeam[];
}

function getDbPlayersForTeam(
  teamId: number,
  seasonId: number,
  competitionId: number
): DbPlayerRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.id AS player_id, pss.id AS stats_id, p.name, p.name_search
       FROM players p
       JOIN player_season_stats pss ON pss.player_id = p.id
       WHERE pss.team_id = ? AND pss.season_id = ? AND pss.competition_id = ?`
    )
    .all(teamId, seasonId, competitionId) as DbPlayerRow[];
}

function normalizeTeamName(name: string): string {
  return normalizeForSearch(name);
}

function matchApiTeam(dbTeam: DbTeam, apiTeams: ApiFootballTeam[]): ApiFootballTeam | null {
  const candidates = [dbTeam.name, dbTeam.short_name]
    .filter((value): value is string => Boolean(value))
    .map(normalizeTeamName);

  for (const apiTeam of apiTeams) {
    const apiName = normalizeTeamName(apiTeam.team.name);
    if (candidates.some((candidate) => candidate === apiName)) {
      return apiTeam;
    }
    if (candidates.some((candidate) => apiName.includes(candidate) || candidate.includes(apiName))) {
      return apiTeam;
    }
  }

  return null;
}

function matchDbPlayer(apiPlayerName: string, dbPlayers: DbPlayerRow[]): DbPlayerRow | null {
  const normalized = normalizeForSearch(apiPlayerName);

  const exact = dbPlayers.find((player) => player.name_search === normalized);
  if (exact) return exact;

  const byName = dbPlayers.find((player) => normalizeForSearch(player.name) === normalized);
  if (byName) return byName;

  const partial = dbPlayers.find((player) => {
    const search = player.name_search ?? normalizeForSearch(player.name);
    return search.includes(normalized) || normalized.includes(search);
  });
  return partial ?? null;
}

function extractStats(entry: ApiFootballPlayerEntry, leagueId: number): {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  teamName: string;
} | null {
  const stat = entry.statistics.find((row) => row.league.id === leagueId) ?? entry.statistics[0];
  if (!stat) return null;

  return {
    appearances: stat.games.appearences ?? 0,
    minutes: stat.games.minutes ?? 0,
    goals: stat.goals.total ?? 0,
    assists: stat.goals.assists ?? 0,
    teamName: stat.team.name,
  };
}

function logUnmatched(rawName: string, rawTeam: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO player_match_log (player_id, match_source, raw_name, raw_team)
     VALUES (NULL, 'api-football-unmatched', ?, ?)`
  ).run(rawName, rawTeam);
}

function updatePlayerStats(
  statsId: number,
  stats: { appearances: number; minutes: number; goals: number; assists: number }
): void {
  const db = getDb();
  db.prepare(
    `UPDATE player_season_stats
     SET appearances = ?, minutes_played = ?, goals = ?, assists = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(stats.appearances, stats.minutes, stats.goals, stats.assists, statsId);
}

async function enrichCompetitionSeason(
  competitionCode: string,
  seasonYear: number
): Promise<{ matched: number; unmatched: number; requests: number; skipped: boolean }> {
  const code = competitionCode.toUpperCase();
  const existing = getFetchState(code, seasonYear);
  if (existing?.status === 'done') {
    console.log(`[skip] ${code} ${seasonYear} already done`);
    return { matched: 0, unmatched: 0, requests: 0, skipped: true };
  }

  const leagueId = getApiFootballLeagueId(code);
  if (!leagueId) {
    throw new Error(`No API-Football league mapping for competition code: ${code}`);
  }

  const seasonContext = getSeasonContext(code, seasonYear);
  if (!seasonContext) {
    throw new Error(`No season found in DB for ${code} ${seasonYear}. Run pilot/backfill first.`);
  }

  const dbTeams = getDbTeams(seasonContext.seasonId, seasonContext.competitionId);
  if (dbTeams.length === 0) {
    console.warn(`[warn] No teams with player stats for ${code} ${seasonYear}`);
    upsertFetchState(code, seasonYear, 'done', 0);
    return { matched: 0, unmatched: 0, requests: 0, skipped: false };
  }

  const requestsAtStart = getRequestsUsedThisSession();
  let matched = 0;
  let unmatched = 0;

  console.log(`\n[enrich] ${code} ${seasonYear} — ${dbTeams.length} team(s), league id ${leagueId}`);

  const apiTeams = await getTeamsByLeagueAndSeason(leagueId, seasonYear);
  const startTeamIndex = existing?.last_page_fetched ?? 0;

  for (let teamIndex = startTeamIndex; teamIndex < dbTeams.length; teamIndex += 1) {
    const dbTeam = dbTeams[teamIndex];
    const apiTeam = matchApiTeam(dbTeam, apiTeams);

    if (!apiTeam) {
      console.warn(`  [team] no API match: ${dbTeam.name}`);
      upsertFetchState(code, seasonYear, 'partial', teamIndex + 1);
      continue;
    }

    console.log(`  [team ${teamIndex + 1}/${dbTeams.length}] ${dbTeam.name} → API id ${apiTeam.team.id}`);

    const dbPlayers = getDbPlayersForTeam(dbTeam.id, seasonContext.seasonId, seasonContext.competitionId);

    try {
      const { players } = await getPlayersByTeamAndSeason(apiTeam.team.id, seasonYear);

      for (const entry of players) {
        const stats = extractStats(entry, leagueId);
        if (!stats) continue;

        const dbPlayer = matchDbPlayer(entry.player.name, dbPlayers);
        if (!dbPlayer) {
          logUnmatched(entry.player.name, stats.teamName);
          unmatched += 1;
          continue;
        }

        updatePlayerStats(dbPlayer.stats_id, stats);
        matched += 1;
      }

      upsertFetchState(code, seasonYear, 'partial', teamIndex + 1);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        upsertFetchState(code, seasonYear, 'partial', teamIndex);
        throw err;
      }
      throw err;
    }
  }

  upsertFetchState(code, seasonYear, 'done', dbTeams.length);

  return {
    matched,
    unmatched,
    requests: getRequestsUsedThisSession() - requestsAtStart,
    skipped: false,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const competitionArg = args.competition;
  const seasonArg = args.season;

  if (!competitionArg || !seasonArg) {
    console.error('Usage: enrich-stats --competition=CL[,PL,...] --season=2024');
    process.exit(1);
  }

  const competitions = competitionArg.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  const seasonYear = parseInt(seasonArg, 10);
  if (Number.isNaN(seasonYear)) {
    console.error('Invalid --season value');
    process.exit(1);
  }

  runMigrations();

  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalRequests = 0;

  try {
    for (const competition of competitions) {
      const result = await enrichCompetitionSeason(competition, seasonYear);
      if (!result.skipped) {
        totalMatched += result.matched;
        totalUnmatched += result.unmatched;
        totalRequests += result.requests;
      }
    }
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      console.log('[rate-limit] günlük limit doldu, state kaydedildi, yarın devam edilecek');
      console.log(
        `\nSummary (partial): ${totalMatched} matched, ${totalUnmatched} unmatched, ${totalRequests} API request(s) used`
      );
      closeDb();
      process.exit(0);
    }
    throw err;
  }

  console.log(
    `\nSummary: ${totalMatched} matched, ${totalUnmatched} unmatched, ${totalRequests} API request(s) used`
  );
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
