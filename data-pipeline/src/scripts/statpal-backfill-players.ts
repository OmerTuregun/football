/**
 * Backfill missing StatPal player IDs into the DB.
 * Usage: npm run statpal-backfill-players -- --ids=3012571,2946021,2693160
 * Or without --ids: find CL 2024-2025 squad IDs not in statpal_fetched_players.
 */
import { closeDb, getDb, runMigrations } from '../db/client';
import { getPlayer, getUserRequestCount } from '../fetch/statpalClient';
import { ingestStatPalPlayer } from '../import/statpalPlayerIngest';
import { StatPalRepository } from '../import/statpalRepository';
import { parseArgs } from '../utils';

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

      const result = ingestStatPalPlayer(repo, id, p);
      ok += 1;
      console.log(
        `  [ok] ${p.name ?? id} stats=${result.statsRows} skippedOtherLeagues=${result.skippedRows}`
      );
    } catch (err) {
      fail += 1;
      console.warn(`  [fail] ${id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[backfill] done ok=${ok} fail=${fail}`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
