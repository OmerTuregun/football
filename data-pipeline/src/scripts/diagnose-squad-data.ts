import { closeDb, runMigrations } from '../db/client';
import { fetchCompetitionTeams } from '../fetchers/footballData';
import { parseArgs } from '../utils';

interface SquadPlayer {
  id?: number;
  name?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  dateOfBirth?: string;
  nationality?: string;
  shirtNumber?: number;
  marketValue?: number | null;
  contract?: unknown;
}

interface TeamWithSquad {
  id: number;
  name: string;
  squad?: SquadPlayer[] | null;
}

interface TeamsResponse {
  teams: TeamWithSquad[];
}

function analyzeSquadFields(squad: SquadPlayer[]): string[] {
  const fields = new Set<string>();
  for (const player of squad) {
    for (const key of Object.keys(player)) {
      if (player[key as keyof SquadPlayer] !== undefined && player[key as keyof SquadPlayer] !== null) {
        fields.add(key);
      }
    }
  }
  return [...fields].sort();
}

function printSeparator(): void {
  console.log('─'.repeat(60));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const competition = args.competition ?? 'CL';

  console.log(`\nSquad data diagnosis for competition: ${competition}`);
  console.log(`Endpoint: GET /v4/competitions/${competition}/teams (current season)\n`);

  runMigrations();

  const result = await fetchCompetitionTeams(competition);

  if (!result.success || !result.data) {
    console.error(`Failed to fetch teams: ${result.error ?? 'unknown error'}`);
    closeDb();
    process.exit(1);
  }

  const data = result.data as TeamsResponse;
  const teams = data.teams ?? [];

  console.log(`Total teams returned: ${teams.length}\n`);

  let withSquad = 0;
  let withoutSquad = 0;

  for (const team of teams) {
    printSeparator();
    console.log(`Team: ${team.name} (id: ${team.id})`);

    const squad = team.squad;

    if (!squad || squad.length === 0) {
      withoutSquad++;
      console.log('  squad: EMPTY (field missing, null, or empty array)');
      continue;
    }

    withSquad++;
    const fields = analyzeSquadFields(squad);
    console.log(`  squad: PRESENT — ${squad.length} player(s)`);
    console.log(`  fields present in squad data: ${fields.join(', ')}`);

    const sample = squad[0];
    console.log('  sample player:');
    for (const field of fields) {
      const value = sample[field as keyof SquadPlayer];
      console.log(`    ${field}: ${JSON.stringify(value)}`);
    }
  }

  printSeparator();
  console.log('\nSummary:');
  console.log(`  Teams with squad data:    ${withSquad}`);
  console.log(`  Teams without squad data: ${withoutSquad}`);
  console.log(`  Cache file:               ${result.cacheFile ?? 'n/a'}`);

  if (withSquad === 0) {
    console.log('\n⚠ Free tier likely does NOT include squad/player data in this endpoint.');
  } else {
    console.log('\n✓ Squad data IS available on free tier for this endpoint.');
  }

  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  closeDb();
  process.exit(1);
});
