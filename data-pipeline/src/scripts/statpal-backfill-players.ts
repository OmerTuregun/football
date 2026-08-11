/**
 * Backfill missing StatPal player IDs into the DB.
 * Usage: npm run statpal-backfill-players -- --ids=3012571,2946021,2693160
 * Or without --ids: find CL 2024-2025 squad IDs not in statpal_fetched_players.
 */
import { closeDb, getDb, runMigrations } from '../db/client';
import { getLeagueByCode } from '../config/statpalMapping';
import { getPlayer, getUserRequestCount } from '../fetch/statpalClient';
import {
  StatPalRepository,
  parseBirthdate,
  parseFloatOrNull,
  parseIntOrNull,
} from '../import/statpalRepository';
import { parseArgs } from '../utils';

function mapStatRow(row: Record<string, unknown>): Record<string, number | null> {
  return {
    appearances: parseIntOrNull(row.appearances ?? row.appearences),
    goals: parseIntOrNull(row.goals),
    assists: parseIntOrNull(row.assists),
    minutes_played: parseIntOrNull(row.minutes_played),
    yellow_cards: parseIntOrNull(row.yellowcards ?? row.yellow_cards),
    red_cards: parseIntOrNull(row.redcards ?? row.red_cards),
    key_passes: parseIntOrNull(row.key_passes),
    pass_attempts: parseIntOrNull(row.pass_attempts),
    pass_success: parseIntOrNull(row.pass_success),
    tackles: parseIntOrNull(row.tackles),
    duels_total: parseIntOrNull(row.duels_total),
    duels_won: parseIntOrNull(row.duels_won),
    dribble_attempts: parseIntOrNull(row.dribble_attempts),
    dribble_success: parseIntOrNull(row.dribble_success),
    rating: parseFloatOrNull(row.rating),
    starting_lineups: parseIntOrNull(row.starting_lineups),
    substitute_in: parseIntOrNull(row.substitute_in),
  };
}

function findMissingFromState(db: ReturnType<typeof getDb>): string[] {
  const teams = db
    .prepare(
      `SELECT cursor_json FROM statpal_fetch_state
       WHERE competition_code = 'CL' AND season = '2024-2025' AND phase = 'teams'`
    )
    .get() as { cursor_json: string } | undefined;
  if (!teams?.cursor_json) return [];
  const cursor = JSON.parse(teams.cursor_json) as { playerIds?: string[] };
  const allIds = [...new Set(cursor.playerIds ?? [])];
  const fetched = new Set(
    (
      db.prepare('SELECT statpal_player_id FROM statpal_fetched_players').all() as Array<{
        statpal_player_id: string;
      }>
    ).map((r) => r.statpal_player_id)
  );
  return allIds.filter((id) => !fetched.has(id));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  runMigrations();
  const db = getDb();
  const repo = new StatPalRepository(db);

  const ids = args.ids
    ? args.ids.split(',').map((s) => s.trim()).filter(Boolean)
    : findMissingFromState(db);

  if (ids.length === 0) {
    console.log('[backfill] no missing players');
    closeDb();
    return;
  }

  console.log(`[backfill] ${ids.length} player id(s): ${ids.join(', ')}`);
  const usage = await getUserRequestCount();
  console.log(`[quota] ${usage.current_date}: ${usage.request_count}`);

  const league = getLeagueByCode(args.competition ?? 'CL');
  if (!league) throw new Error('Unknown competition');
  const season = args.season ?? '2024-2025';
  const competitionId = repo.ensureCompetition(league.code, league.statpalName);
  const seasonId = repo.ensureSeason(competitionId, season);

  let ok = 0;
  let fail = 0;

  for (const id of ids) {
    if (repo.isPlayerFetched(id)) {
      console.log(`  [skip] ${id} already fetched`);
      continue;
    }
    try {
      console.log(`  [fetch] /players/${id}`);
      const raw = (await getPlayer(id)) as { player?: Record<string, unknown> };
      const p = raw.player;
      if (!p) {
        console.warn(`  [empty] ${id}`);
        fail += 1;
        continue;
      }

      const playerId = repo.upsertPlayer(String(p.id ?? id), String(p.name ?? 'Unknown'), {
        firstName: p.firstname ? String(p.firstname) : undefined,
        lastName: p.lastname ? String(p.lastname) : undefined,
        birthdate: parseBirthdate(p.birthdate ? String(p.birthdate) : undefined) ?? undefined,
        nationality: p.nationality ? String(p.nationality) : undefined,
        position: p.position ? String(p.position) : undefined,
        marketValueEur: parseIntOrNull(p.market_value_eur),
      });
      repo.markPlayerFetched(id, playerId);

      for (const block of [
        p.club_league_statistics,
        p.club_domestic_cup_statistics,
        p.club_intl_cup_statistics,
      ] as Array<{ club?: Array<Record<string, unknown>> } | undefined>) {
        for (const row of block?.club ?? []) {
          const teamStatpalId = row.team_id ? String(row.team_id) : null;
          if (!teamStatpalId) continue;
          const teamId = repo.upsertTeam(teamStatpalId, String(row.team_name ?? 'Unknown'));
          const rowSeason = String(row.season ?? season);
          if (rowSeason !== season && !rowSeason.includes(season.split('-')[0])) continue;
          repo.upsertPlayerSeasonStats(
            playerId,
            teamId,
            seasonId,
            competitionId,
            rowSeason,
            String(row.league_id ?? league.leagueId),
            mapStatRow(row)
          );
        }
      }

      for (const tr of (p.transfers as Array<Record<string, unknown>> | undefined) ?? []) {
        repo.insertTransfer(playerId, {
          date: tr.date ? String(tr.date) : undefined,
          type: tr.type ? String(tr.type) : undefined,
          price: tr.price ? String(tr.price) : undefined,
          from: tr.from ? String(tr.from) : undefined,
          fromId: tr.from_id ? String(tr.from_id) : undefined,
          to: tr.to ? String(tr.to) : undefined,
          toId: tr.to_id ? String(tr.to_id) : undefined,
        });
      }

      const trophiesRaw = p.trophies;
      const trophyList: Array<Record<string, unknown>> = [];
      if (Array.isArray(trophiesRaw)) trophyList.push(...trophiesRaw);
      else if (trophiesRaw && typeof trophiesRaw === 'object') {
        for (const [key, val] of Object.entries(trophiesRaw as Record<string, unknown>)) {
          if (val && typeof val === 'object') {
            trophyList.push({ ...(val as Record<string, unknown>), league: key });
          }
        }
      }
      repo.replacePlayerTrophies(playerId, trophyList);

      console.log(
        `  [ok] ${id} → db#${playerId} name="${p.name}" pos=${p.position ?? '?'} nation=${p.nationality ?? '?'}`
      );
      ok += 1;
    } catch (err) {
      console.warn(`  [fail] ${id}:`, err instanceof Error ? err.message : err);
      fail += 1;
    }
  }

  const after = await getUserRequestCount();
  console.log(`[backfill] done ok=${ok} fail=${fail} dailyUsed=${after.request_count}`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
