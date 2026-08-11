import { closeDb, runMigrations } from '../db/client';
import {
  fetchCompetition,
  fetchCompetitionTeams,
  fetchCompetitionMatches,
  fetchCompetitionStandings,
  type FetchResult,
} from '../fetchers/footballData';
import {
  normalizeCompetitions,
  getSeasonIdForYear,
} from '../transform/normalizeCompetitions';
import { normalizeTeams } from '../transform/normalizeTeams';
import { normalizePlayers, type TeamWithSquad } from '../transform/normalizePlayers';
import { normalizeMatches } from '../transform/normalizeMatches';
import { normalizeStandings } from '../transform/normalizeStandings';
import { parseArgs } from '../utils';

type CompetitionRaw = Parameters<typeof normalizeCompetitions>[0];

interface CompetitionBackfillResult {
  code: string;
  succeeded: number;
  restricted: number;
  failed: number;
  totalTeams: number;
  totalMatches: number;
  totalPlayers: number;
  competitionFetchFailed: boolean;
}

class SubscriptionRestrictedError extends Error {
  constructor(resource: string) {
    super(`not available on current API subscription (HTTP 403) — ${resource}`);
    this.name = 'SubscriptionRestrictedError';
  }
}

function assertFetchSuccess<T>(resource: string, result: FetchResult<T>): T {
  if (result.success && result.data) return result.data;
  if (result.httpStatus === 403) {
    throw new SubscriptionRestrictedError(resource);
  }
  throw new Error(result.error ?? `${resource} fetch failed`);
}

function isSubscriptionRestricted(err: unknown): boolean {
  return err instanceof SubscriptionRestrictedError;
}

async function fetchAndNormalizeStandings(
  competition: string,
  year: number,
  seasonId: number
): Promise<{ count: number; unavailable: boolean }> {
  const standingsResult = await fetchCompetitionStandings(competition, year);
  if (standingsResult.httpStatus === 404) {
    return { count: 0, unavailable: true };
  }
  const standingsData = assertFetchSuccess('standings', standingsResult);
  const count = normalizeStandings(
    standingsData as Parameters<typeof normalizeStandings>[0],
    seasonId
  );
  return { count, unavailable: false };
}

function formatStandingsSummary(count: number, unavailable: boolean): string {
  if (unavailable) return 'standings not available for this competition';
  return `${count} standings row(s)`;
}

async function processSeason(
  competition: string,
  year: number,
  seasonId: number,
  competitionId: number
): Promise<{
  teams: number;
  matches: number;
  standings: number;
  standingsUnavailable: boolean;
  players: number;
  memberships: number;
  membershipsNew: number;
}> {
  const teamsResponse = assertFetchSuccess(
    'teams',
    await fetchCompetitionTeams(competition, year)
  ) as { teams: TeamWithSquad[] };

  const teamCount = normalizeTeams(teamsResponse);
  const { players, memberships, membershipsNew } = normalizePlayers(
    teamsResponse.teams,
    seasonId,
    competitionId
  );

  const matchesData = assertFetchSuccess(
    'matches',
    await fetchCompetitionMatches(competition, year)
  );
  const matchCount = normalizeMatches(matchesData as Parameters<typeof normalizeMatches>[0]);

  const { count: standingsCount, unavailable: standingsUnavailable } =
    await fetchAndNormalizeStandings(competition, year, seasonId);

  return {
    teams: teamCount,
    matches: matchCount,
    standings: standingsCount,
    standingsUnavailable,
    players,
    memberships,
    membershipsNew,
  };
}

async function runBackfillForCompetition(
  competition: string,
  fromYear: number,
  toYear: number
): Promise<CompetitionBackfillResult> {
  const result: CompetitionBackfillResult = {
    code: competition,
    succeeded: 0,
    restricted: 0,
    failed: 0,
    totalTeams: 0,
    totalMatches: 0,
    totalPlayers: 0,
    competitionFetchFailed: false,
  };

  const restrictedYears: number[] = [];
  const failedYears: number[] = [];

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Backfill: ${competition} (${fromYear}–${toYear})`);

  console.log('\nFetching competition metadata (once)...');
  const compResult = await fetchCompetition(competition);
  if (!compResult.success || !compResult.data) {
    console.error(`Competition fetch failed: ${compResult.error ?? 'unknown error'}`);
    result.competitionFetchFailed = true;
    result.failed = toYear - fromYear + 1;
    return result;
  }

  const compData = compResult.data as CompetitionRaw;
  const compStats = normalizeCompetitions(compData);
  console.log(
    `  OK — ${compStats.competitions} competition, ${compStats.seasons} season(s) upserted`
  );

  for (let year = fromYear; year <= toYear; year++) {
    let seasonId: number;
    try {
      seasonId = getSeasonIdForYear(compData, year);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${competition}/${year}] FAILED: ${message}`);
      result.failed++;
      failedYears.push(year);
      continue;
    }

    try {
      const {
        teams,
        matches,
        standings,
        standingsUnavailable,
        players,
        memberships,
        membershipsNew,
      } = await processSeason(competition, year, seasonId, compData.id);
      const membershipNote =
        membershipsNew < memberships ? ` (${membershipsNew} new)` : '';
      console.log(
        `[${competition}/${year}] OK — ${teams} team(s), ${matches} match(es), ${formatStandingsSummary(standings, standingsUnavailable)}, ${players} player(s), ${memberships} membership(s)${membershipNote}`
      );
      result.succeeded++;
      result.totalTeams += teams;
      result.totalMatches += matches;
      result.totalPlayers += players;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isSubscriptionRestricted(err)) {
        console.warn(`[${competition}/${year}] SKIP: ${message}`);
        result.restricted++;
        restrictedYears.push(year);
      } else {
        console.error(`[${competition}/${year}] FAILED: ${message}`);
        result.failed++;
        failedYears.push(year);
      }
    }
  }

  console.log(`\n${competition} summary: ${result.succeeded} succeeded, ${result.restricted} restricted, ${result.failed} failed`);
  if (restrictedYears.length > 0) {
    console.log(`  Skipped years: ${restrictedYears.join(', ')}`);
  }
  if (failedYears.length > 0) {
    console.log(`  Failed years:  ${failedYears.join(', ')}`);
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const competitions = (args.competition ?? 'CL')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);

  if (!args.from) {
    console.error('Missing required argument: --from=YYYY');
    process.exit(1);
  }

  const fromYear = parseInt(args.from, 10);
  const toYear = args.to ? parseInt(args.to, 10) : fromYear;

  if (Number.isNaN(fromYear) || Number.isNaN(toYear)) {
    console.error('Invalid --from or --to year');
    process.exit(1);
  }

  if (fromYear > toYear) {
    console.error('--from must be less than or equal to --to');
    process.exit(1);
  }

  console.log(`\nBackfill: ${competitions.join(', ')} (${fromYear}–${toYear})`);
  console.log(
    '  Note: Free tier often returns HTTP 403 for historical teams/matches/standings; those years are skipped.'
  );
  runMigrations();

  const results: CompetitionBackfillResult[] = [];
  for (const code of competitions) {
    results.push(await runBackfillForCompetition(code, fromYear, toYear));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Combined backfill summary:');
  console.table(
    results.map((r) => ({
      competition: r.code,
      succeeded: r.succeeded,
      restricted: r.restricted,
      failed: r.failed,
      teams: r.totalTeams,
      matches: r.totalMatches,
      players: r.totalPlayers,
      fetch_failed: r.competitionFetchFailed ? 'yes' : '',
    }))
  );

  const totals = results.reduce(
    (acc, r) => ({
      succeeded: acc.succeeded + r.succeeded,
      restricted: acc.restricted + r.restricted,
      failed: acc.failed + r.failed,
      teams: acc.teams + r.totalTeams,
      matches: acc.matches + r.totalMatches,
      players: acc.players + r.totalPlayers,
    }),
    { succeeded: 0, restricted: 0, failed: 0, teams: 0, matches: 0, players: 0 }
  );

  console.log('Totals across all competitions:');
  console.log(`  Seasons succeeded: ${totals.succeeded}`);
  console.log(`  Seasons restricted: ${totals.restricted}`);
  console.log(`  Seasons failed:     ${totals.failed}`);
  console.log(`  Teams (sum):        ${totals.teams}`);
  console.log(`  Matches (sum):      ${totals.matches}`);
  console.log(`  Players (sum):      ${totals.players}`);
  console.log('═'.repeat(60));

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb();
  process.exit(1);
});
