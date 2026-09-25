/**
 * Clean polluted StatPal season stats (wrong league_id under a competition),
 * reset players phases, clear fetched flags for squad players, then optionally
 * re-import with --force-players.
 *
 * Usage:
 *   npm run statpal-repair-stats
 *   npm run statpal-repair-stats -- --import=true
 *   npm run statpal-repair-stats -- --competition=PL --import=true
 */
import { closeDb, getDb, runMigrations } from '../db/client';
import {
  STATPAL_LEAGUES,
  STATPAL_TARGET_SEASONS,
  getLeagueByCode,
  type StatPalLeagueConfig,
} from '../config/statpalMapping';
import { getUserRequestCount } from '../fetch/statpalClient';
import { expectedLeagueIdByCode } from '../import/statpalPlayerIngest';
import { parseArgs } from '../utils';

interface PhaseCursor {
  playerIds?: string[];
  playerIndex?: number;
  failedPlayerIds?: string[];
}

function cleanPollutedStats(db: ReturnType<typeof getDb>): number {
  let deleted = 0;
  const del = db.prepare(
    `DELETE FROM player_season_stats
     WHERE competition_id = ?
       AND stat_source = 'statpal'
       AND statpal_league_id IS NOT NULL
       AND statpal_league_id != ?`
  );

  for (const league of STATPAL_LEAGUES) {
    const comp = db
      .prepare(`SELECT id FROM competitions WHERE code = ?`)
      .get(league.code) as { id: number } | undefined;
    if (!comp) continue;
    const result = del.run(comp.id, league.leagueId);
    deleted += Number(result.changes ?? 0);
    console.log(
      `  [clean] ${league.code}: removed ${result.changes} row(s) not matching league ${league.leagueId}`
    );
  }
  return deleted;
}

function collectSeasons(db: ReturnType<typeof getDb>, leagues: StatPalLeagueConfig[]): string[] {
  const fromState = db
    .prepare(
      `SELECT DISTINCT season FROM statpal_fetch_state
       WHERE competition_code IN (${leagues.map(() => '?').join(',')})
       ORDER BY season`
    )
    .all(...leagues.map((l) => l.code)) as Array<{ season: string }>;

  const set = new Set<string>([...STATPAL_TARGET_SEASONS, ...fromState.map((r) => r.season)]);
  return [...set].sort();
}

function resetPlayersPhases(
  db: ReturnType<typeof getDb>,
  leagues: StatPalLeagueConfig[],
  seasons: string[]
): { phases: number; playerIds: string[] } {
  const playerIdSet = new Set<string>();
  let phases = 0;

  const getTeams = db.prepare(
    `SELECT cursor_json FROM statpal_fetch_state
     WHERE competition_code = ? AND season = ? AND phase = 'teams'`
  );
  const upsertPlayers = db.prepare(
    `INSERT INTO statpal_fetch_state (competition_code, season, phase, status, cursor_json, updated_at)
     VALUES (?, ?, 'players', 'pending', ?, datetime('now'))
     ON CONFLICT(competition_code, season, phase) DO UPDATE SET
       status = 'pending',
       cursor_json = excluded.cursor_json,
       updated_at = datetime('now')`
  );

  for (const league of leagues) {
    for (const season of seasons) {
      const teamsRow = getTeams.get(league.code, season) as { cursor_json: string } | undefined;
      if (!teamsRow?.cursor_json) continue;

      const teamsCursor = JSON.parse(teamsRow.cursor_json) as PhaseCursor;
      const playerIds = [...new Set(teamsCursor.playerIds ?? [])];
      for (const id of playerIds) playerIdSet.add(id);

      const playersCursor: PhaseCursor = {
        playerIds,
        playerIndex: 0,
        failedPlayerIds: [],
      };
      upsertPlayers.run(league.code, season, JSON.stringify(playersCursor));
      phases += 1;
      console.log(`  [reset] ${league.code} ${season} players pending (${playerIds.length} ids)`);
    }
  }

  return { phases, playerIds: [...playerIdSet] };
}

function clearFetchedPlayers(db: ReturnType<typeof getDb>, playerIds: string[]): number {
  if (playerIds.length === 0) return 0;
  const del = db.prepare(`DELETE FROM statpal_fetched_players WHERE statpal_player_id = ?`);
  const tx = db.transaction((ids: string[]) => {
    let n = 0;
    for (const id of ids) n += Number(del.run(id).changes ?? 0);
    return n;
  });
  return tx(playerIds);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  runMigrations();
  const db = getDb();

  const leagues = args.competition
    ? ([getLeagueByCode(args.competition)].filter(Boolean) as StatPalLeagueConfig[])
    : STATPAL_LEAGUES;

  if (leagues.length === 0) {
    console.error('Unknown --competition');
    process.exit(1);
  }

  console.log('[repair] cleaning polluted StatPal stats…');
  const deleted = cleanPollutedStats(db);
  console.log(`[repair] deleted ${deleted} polluted row(s)`);

  const seasons = args.season ? [args.season] : collectSeasons(db, leagues);
  console.log(`[repair] seasons: ${seasons.join(', ')}`);

  console.log('[repair] resetting players phases…');
  const { phases, playerIds } = resetPlayersPhases(db, leagues, seasons);
  console.log(`[repair] reset ${phases} players phase(s), ${playerIds.length} unique player id(s)`);

  const cleared = clearFetchedPlayers(db, playerIds);
  console.log(`[repair] cleared ${cleared} fetched-player flag(s)`);

  // sanity after clean
  for (const league of leagues) {
    const expected = expectedLeagueIdByCode(league.code);
    if (!expected) continue;
    const row = db
      .prepare(
        `SELECT
           SUM(CASE WHEN pss.stat_source='statpal' AND pss.statpal_league_id = ? THEN 1 ELSE 0 END) AS matched,
           SUM(CASE WHEN pss.stat_source='statpal' AND pss.statpal_league_id IS NOT NULL AND pss.statpal_league_id != ? THEN 1 ELSE 0 END) AS polluted
         FROM player_season_stats pss
         JOIN competitions c ON c.id = pss.competition_id
         WHERE c.code = ?`
      )
      .get(expected, expected, league.code) as { matched: number; polluted: number };
    console.log(
      `  [check] ${league.code}: matched=${row.matched ?? 0} polluted=${row.polluted ?? 0}`
    );
  }

  if (args.import !== 'true') {
    console.log(
      '[repair] cleanup done. Re-import with:\n' +
        '  npm run statpal-import -- --force-players=true\n' +
        'or per league:\n' +
        '  npm run statpal-import -- --competition=PL --force-players=true'
    );
    closeDb();
    return;
  }

  closeDb();

  const usage = await getUserRequestCount();
  console.log(`[quota] ${usage.current_date}: ${usage.request_count}`);
  console.log('[repair] starting force players import…');

  // Dynamic import to reuse main import entry after DB closed — spawn via child is cleaner
  const { spawnSync } = await import('child_process');
  for (const league of leagues) {
    for (const season of seasons) {
      console.log(`\n[repair-import] ${league.code} ${season}`);
      const result = spawnSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        [
          'ts-node',
          'src/scripts/statpal-import.ts',
          `--competition=${league.code}`,
          `--season=${season}`,
          '--force-players=true',
        ],
        { cwd: process.cwd(), stdio: 'inherit', shell: true }
      );
      if (result.status !== 0) {
        console.error(`[repair-import] failed for ${league.code} ${season} status=${result.status}`);
        process.exit(result.status ?? 1);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
