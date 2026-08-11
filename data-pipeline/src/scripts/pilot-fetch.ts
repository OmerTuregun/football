import { closeDb, runMigrations } from '../db/client';
import {
  fetchCompetition,
  fetchCompetitionTeams,
  fetchCompetitionMatches,
  fetchCompetitionStandings,
} from '../fetchers/footballData';
import {
  normalizeCompetitions,
  getCurrentSeasonYear,
  getCurrentSeasonId,
  getSeasonIdForYear,
} from '../transform/normalizeCompetitions';
import { normalizeTeams } from '../transform/normalizeTeams';
import { normalizePlayers } from '../transform/normalizePlayers';
import { normalizeMatches } from '../transform/normalizeMatches';
import { normalizeStandings } from '../transform/normalizeStandings';
import { parseArgs } from '../utils';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const competition = args.competition ?? 'CL';
  const seasonArg = args.season ? parseInt(args.season, 10) : undefined;

  console.log(`\nPilot fetch: ${competition}`);
  runMigrations();

  // 1. Competition
  console.log('\n[1/4] Fetching competition...');
  const compResult = await fetchCompetition(competition);
  if (!compResult.success || !compResult.data) {
    console.error(`  Failed: ${compResult.error}`);
  } else {
    const compStats = normalizeCompetitions(compResult.data as Parameters<typeof normalizeCompetitions>[0]);
    console.log(`  OK — ${compStats.competitions} competition, ${compStats.seasons} season(s) upserted`);
  }

  let seasonYear = seasonArg;
  let seasonId: number | undefined;
  let competitionId: number | undefined;

  if (compResult.success && compResult.data) {
    const compData = compResult.data as Parameters<typeof getCurrentSeasonYear>[0];
    competitionId = compData.id;
    if (!seasonYear) seasonYear = getCurrentSeasonYear(compData);
    seasonId = seasonArg ? getSeasonIdForYear(compData, seasonYear!) : getCurrentSeasonId(compData);
    console.log(`  Using season year: ${seasonYear} (season id: ${seasonId})`);
  } else if (!seasonYear) {
    console.error('Cannot determine season year without competition data. Pass --season=YYYY');
    closeDb();
    process.exit(1);
  }

  // 2. Teams
  console.log('\n[2/4] Fetching teams...');
  const teamsResult = await fetchCompetitionTeams(competition, seasonYear);
  let teamCount = 0;
  if (!teamsResult.success || !teamsResult.data) {
    console.error(`  Failed: ${teamsResult.error}`);
  } else {
    teamCount = normalizeTeams(teamsResult.data as Parameters<typeof normalizeTeams>[0]);
    console.log(`  OK — ${teamCount} team(s) upserted`);
    if (seasonId !== undefined && competitionId !== undefined) {
      const teamsData = teamsResult.data as { teams: Parameters<typeof normalizePlayers>[0] };
      const { players, memberships, membershipsNew } = normalizePlayers(
        teamsData.teams,
        seasonId,
        competitionId
      );
      const membershipNote =
        membershipsNew < memberships ? ` (${membershipsNew} new)` : '';
      console.log(`  + ${players} player(s), ${memberships} membership(s)${membershipNote}`);
    }
  }

  // 3. Matches
  console.log('\n[3/4] Fetching matches...');
  const matchesResult = await fetchCompetitionMatches(competition, seasonYear);
  let matchCount = 0;
  if (!matchesResult.success || !matchesResult.data) {
    console.error(`  Failed: ${matchesResult.error}`);
  } else {
    matchCount = normalizeMatches(matchesResult.data as Parameters<typeof normalizeMatches>[0]);
    console.log(`  OK — ${matchCount} match(es) upserted`);
  }

  // 4. Standings
  console.log('\n[4/4] Fetching standings...');
  const standingsResult = await fetchCompetitionStandings(competition, seasonYear);
  let standingsCount = 0;
  if (standingsResult.httpStatus === 404) {
    console.log('  OK — standings not available for this competition');
  } else if (!standingsResult.success || !standingsResult.data) {
    console.error(`  Failed: ${standingsResult.error}`);
  } else {
    standingsCount = normalizeStandings(
      standingsResult.data as Parameters<typeof normalizeStandings>[0],
      seasonId
    );
    console.log(`  OK — ${standingsCount} standings row(s) upserted`);
  }

  console.log('\n' + '═'.repeat(40));
  console.log('Pilot fetch summary:');
  console.log(`  Competition:  ${competition}`);
  console.log(`  Season year:    ${seasonYear}`);
  console.log(`  Teams:          ${teamCount}`);
  console.log(`  Matches:        ${matchCount}`);
  console.log(`  Standings rows: ${standingsCount}`);
  console.log('═'.repeat(40));

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb();
  process.exit(1);
});
