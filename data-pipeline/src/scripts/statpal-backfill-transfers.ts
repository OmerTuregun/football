/**
 * Backfill missing transfers for StatPal players that already exist in DB
 * but have 0 transfer rows (common when player was only seen via lineups).
 *
 * Usage:
 *   npm run statpal-backfill-transfers -- --limit=200
 *   npm run statpal-backfill-transfers -- --ids=2745668,123
 *   npm run statpal-backfill-transfers -- --limit=500 --priority=elite
 *
 * Docker:
 *   LIMIT=200 docker compose --profile tools run --rm statpal-backfill-transfers
 */
import { closeDb, getDb, runMigrations } from '../db/client';
import { getPlayer, getUserRequestCount } from '../fetch/statpalClient';
import { StatPalRepository } from '../import/statpalRepository';
import { parseArgs } from '../utils';

const ELITE_NAME_SQL = [
  '%real madrid%',
  '%barcelona%',
  '%bayern%',
  '%dortmund%',
  '%manchester city%',
  '%manchester united%',
  '%liverpool%',
  '%arsenal%',
  '%chelsea%',
  '%tottenham%',
  '%juventus%',
  '%internazionale%',
  '%ac milan%',
  '%napoli%',
  '%paris%',
  '%atletico%',
  '%atlético%',
];

function findEliteTeamIds(db: ReturnType<typeof getDb>): number[] {
  const likeSql = ELITE_NAME_SQL.map(() => 'lower(name) LIKE ?').join(' OR ');
  const rows = db
    .prepare(`SELECT id FROM teams WHERE ${likeSql}`)
    .all(...ELITE_NAME_SQL) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function findCandidates(
  db: ReturnType<typeof getDb>,
  limit: number,
  priority: string
): Array<{ id: number; statpal_id: string; name: string }> {
  if (priority === 'elite') {
    const teamIds = findEliteTeamIds(db);
    if (teamIds.length === 0) return [];
    const placeholders = teamIds.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT p.id, p.statpal_id, p.name, COUNT(*) AS lineup_n
         FROM match_lineups ml
         JOIN players p ON p.id = ml.player_id
         WHERE ml.team_id IN (${placeholders})
           AND p.statpal_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM transfers x WHERE x.player_id = p.id)
         GROUP BY p.id, p.statpal_id, p.name
         ORDER BY lineup_n DESC, p.id ASC
         LIMIT ?`
      )
      .all(...teamIds, limit) as Array<{
      id: number;
      statpal_id: string;
      name: string;
    }>;
  }

  return db
    .prepare(
      `SELECT p.id, p.statpal_id, p.name, COUNT(ml.rowid) AS lineup_n
       FROM players p
       LEFT JOIN match_lineups ml ON ml.player_id = p.id
       WHERE p.statpal_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.player_id = p.id)
       GROUP BY p.id, p.statpal_id, p.name
       HAVING lineup_n > 0
           OR EXISTS (SELECT 1 FROM player_season_stats pss WHERE pss.player_id = p.id)
       ORDER BY lineup_n DESC, p.id ASC
       LIMIT ?`
    )
    .all(limit) as Array<{ id: number; statpal_id: string; name: string }>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  runMigrations();
  const db = getDb();
  const repo = new StatPalRepository(db);

  const limit = Math.max(1, parseInt(args.limit ?? '200', 10) || 200);
  const priority = args.priority ?? 'lineups';

  let candidates: Array<{ id: number; statpal_id: string; name: string }>;
  if (args.ids) {
    const ids = args.ids.split(',').map((s) => s.trim()).filter(Boolean);
    candidates = ids
      .map((statpalId) => {
        const row = db
          .prepare(
            `SELECT id, statpal_id, name FROM players WHERE statpal_id = ? OR id = ?`
          )
          .get(statpalId, Number(statpalId) || -1) as
          | { id: number; statpal_id: string; name: string }
          | undefined;
        return row;
      })
      .filter((r): r is { id: number; statpal_id: string; name: string } => !!r?.statpal_id);
  } else {
    candidates = findCandidates(db, limit, priority);
  }

  if (candidates.length === 0) {
    console.log('[backfill-transfers] no candidates');
    closeDb();
    return;
  }

  console.log(`[backfill-transfers] ${candidates.length} player(s) (limit=${limit}, priority=${priority})`);
  try {
    const usage = await getUserRequestCount();
    console.log(`[quota] ${usage.current_date}: ${usage.request_count}`);
  } catch (err) {
    console.warn('[quota] unavailable:', err instanceof Error ? err.message : err);
  }

  let ok = 0;
  let fail = 0;
  let transfersAdded = 0;
  let emptyTransfers = 0;

  for (const cand of candidates) {
    try {
      console.log(`  [fetch] /players/${cand.statpal_id} (${cand.name})`);
      const raw = (await getPlayer(cand.statpal_id)) as { player?: Record<string, unknown> };
      const p = raw.player;
      if (!p) {
        console.warn(`  [empty] ${cand.statpal_id}`);
        fail += 1;
        continue;
      }

      const transfers = (p.transfers as Array<Record<string, unknown>> | undefined) ?? [];
      if (transfers.length === 0) {
        console.log(`  [none] ${cand.statpal_id} profile has 0 transfers`);
        emptyTransfers += 1;
        ok += 1;
        continue;
      }

      let added = 0;
      for (const tr of transfers) {
        if (
          repo.insertTransfer(cand.id, {
            date: tr.date ? String(tr.date) : undefined,
            type: tr.type ? String(tr.type) : undefined,
            price: tr.price ? String(tr.price) : undefined,
            from: tr.from ? String(tr.from) : undefined,
            fromId: tr.from_id ? String(tr.from_id) : undefined,
            to: tr.to ? String(tr.to) : undefined,
            toId: tr.to_id ? String(tr.to_id) : undefined,
          })
        ) {
          added += 1;
        }
      }

      transfersAdded += added;
      console.log(`  [ok] db#${cand.id} +${added}/${transfers.length} transfers`);
      ok += 1;
    } catch (err) {
      console.warn(`  [fail] ${cand.statpal_id}:`, err instanceof Error ? err.message : err);
      fail += 1;
    }
  }

  try {
    const after = await getUserRequestCount();
    console.log(
      `[backfill-transfers] done ok=${ok} fail=${fail} emptyProfiles=${emptyTransfers} transfersAdded=${transfersAdded} dailyUsed=${after.request_count}`
    );
  } catch {
    console.log(
      `[backfill-transfers] done ok=${ok} fail=${fail} emptyProfiles=${emptyTransfers} transfersAdded=${transfersAdded}`
    );
  }
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
