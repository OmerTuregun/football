/**
 * Backfill match detail from football-data.org:
 *   GET /matches/{id} → goals[] + penalties[] (shootout kicks)
 *
 * Usage:
 *   npm run backfill-match-details -- --only-shootouts --limit=20
 *   npm run backfill-match-details -- --competition=EC --only-shootouts
 *   npm run backfill-match-details -- --ids=428788,428790
 *   npm run backfill-match-details -- --force --only-shootouts --limit=5
 */
import fs from 'fs';
import path from 'path';
import { closeDb, getDb, runMigrations } from '../db/client';
import { RAW_CACHE_DIR } from '../config';
import { fetchMatchDetail } from '../fetchers/footballData';
import {
  normalizeMatchDetail,
  type MatchDetailRaw,
} from '../transform/normalizeMatchDetail';
import { parseArgs } from '../utils';

interface Candidate {
  id: number;
  competition_id: number;
  duration: string | null;
  details_fetched_at: string | null;
}

/** Seed matches.duration / penalty totals from competition match list caches (no API). */
function seedDurationFromRawCache(): number {
  const db = getDb();
  if (!fs.existsSync(RAW_CACHE_DIR)) return 0;

  const files = fs
    .readdirSync(RAW_CACHE_DIR)
    .filter((f) => f.startsWith('footballData_competitions_') && f.includes('_matches_'));

  const update = db.prepare(
    `UPDATE matches SET
       duration = ?,
       regular_home = COALESCE(?, regular_home),
       regular_away = COALESCE(?, regular_away),
       extra_home = COALESCE(?, extra_home),
       extra_away = COALESCE(?, extra_away),
       penalty_home = COALESCE(?, penalty_home),
       penalty_away = COALESCE(?, penalty_away),
       updated_at = datetime('now')
     WHERE id = ?`
  );

  let updated = 0;
  const applyFile = db.transaction(
    (
      items: Array<{
        id: number;
        duration: string;
        regular_home: number | null;
        regular_away: number | null;
        extra_home: number | null;
        extra_away: number | null;
        penalty_home: number | null;
        penalty_away: number | null;
      }>
    ) => {
      let n = 0;
      for (const m of items) {
        // Only care about shootouts for candidate discovery; still store any duration cheaply
        const result = update.run(
          m.duration,
          m.regular_home,
          m.regular_away,
          m.extra_home,
          m.extra_away,
          m.penalty_home,
          m.penalty_away,
          m.id
        );
        n += result.changes;
      }
      return n;
    }
  );

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(RAW_CACHE_DIR, file), 'utf-8')) as {
        matches?: Array<{
          id: number;
          score?: {
            duration?: string;
            regularTime?: { home?: number | null; away?: number | null };
            extraTime?: { home?: number | null; away?: number | null };
            penalties?: { home?: number | null; away?: number | null };
          };
        }>;
      };
      const batch = (raw.matches ?? [])
        .filter((m) => m.score?.duration)
        .map((m) => ({
          id: m.id,
          duration: m.score!.duration!,
          regular_home: m.score?.regularTime?.home ?? null,
          regular_away: m.score?.regularTime?.away ?? null,
          extra_home: m.score?.extraTime?.home ?? null,
          extra_away: m.score?.extraTime?.away ?? null,
          penalty_home: m.score?.penalties?.home ?? null,
          penalty_away: m.score?.penalties?.away ?? null,
        }));
      if (batch.length === 0) continue;
      updated += applyFile(batch);
      console.log(`[seed] ${file}: ${batch.length} scored rows`);
    } catch (err) {
      console.warn(`[seed] skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return updated;
}

function listCandidates(opts: {
  onlyShootouts: boolean;
  force: boolean;
  competitionCode?: string;
  ids?: number[];
  limit: number;
}): Candidate[] {
  const db = getDb();

  if (opts.ids?.length) {
    const placeholders = opts.ids.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT id, competition_id, duration, details_fetched_at
         FROM matches WHERE id IN (${placeholders})
         ORDER BY utc_date DESC`
      )
      .all(...opts.ids) as Candidate[];
  }

  const params: Array<string | number> = [];
  let sql = `
    SELECT m.id, m.competition_id, m.duration, m.details_fetched_at
    FROM matches m
  `;

  if (opts.competitionCode) {
    sql += ` JOIN competitions c ON c.id = m.competition_id `;
  }

  sql += ` WHERE 1=1 `;

  if (opts.onlyShootouts) {
    sql += ` AND m.duration = 'PENALTY_SHOOTOUT' `;
  }

  if (!opts.force) {
    sql += ` AND m.details_fetched_at IS NULL `;
  }

  if (opts.competitionCode) {
    sql += ` AND c.code = ? `;
    params.push(opts.competitionCode);
  }

  sql += ` ORDER BY m.utc_date DESC LIMIT ? `;
  params.push(opts.limit);

  return db.prepare(sql).all(...params) as Candidate[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const onlyShootouts = args['only-shootouts'] !== 'false';
  const force = args.force === 'true' || args.force === '1';
  const limit = parseInt(args.limit ?? '50', 10);
  const competitionCode = args.competition?.toUpperCase();
  const ids = args.ids
    ? args.ids
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n))
    : undefined;

  runMigrations();

  console.log('[backfill-match-details] seeding duration from raw-cache…');
  const seeded = seedDurationFromRawCache();
  console.log(`[backfill-match-details] seeded/updated ${seeded} match score rows`);

  const shootoutCount = (
    getDb()
      .prepare(`SELECT COUNT(*) AS c FROM matches WHERE duration = 'PENALTY_SHOOTOUT'`)
      .get() as { c: number }
  ).c;
  console.log(`[backfill-match-details] PENALTY_SHOOTOUT matches in DB: ${shootoutCount}`);

  const candidates = listCandidates({
    onlyShootouts,
    force,
    competitionCode,
    ids,
    limit,
  });

  console.log(
    `[backfill-match-details] candidates=${candidates.length} ` +
      `(onlyShootouts=${onlyShootouts}, force=${force}, limit=${limit}` +
      `${competitionCode ? `, competition=${competitionCode}` : ''})`
  );

  if (candidates.length === 0) {
    console.log('[backfill-match-details] nothing to do');
    closeDb();
    return;
  }

  let ok = 0;
  let fail = 0;
  let goalsTotal = 0;
  let kicksTotal = 0;

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    console.log(
      `[${i + 1}/${candidates.length}] match ${m.id} duration=${m.duration ?? '?'}…`
    );

    const result = await fetchMatchDetail(m.id);
    if (!result.success || !result.data) {
      console.warn(`  fail: ${result.error ?? 'no data'}`);
      fail++;
      continue;
    }

    try {
      const stats = normalizeMatchDetail(result.data as MatchDetailRaw);
      goalsTotal += stats.goals;
      kicksTotal += stats.penaltyKicks;
      ok++;
      console.log(
        `  ok: goals=${stats.goals} penaltyKicks=${stats.penaltyKicks} duration=${stats.duration}`
      );
      if (m.duration === 'PENALTY_SHOOTOUT' && stats.penaltyKicks === 0) {
        console.warn(
          '  warn: shootout match but API returned no penalties[] — ' +
            'football-data free/restricted tier often omits goals/penalties arrays. ' +
            'Score totals (penalty_home/away) were saved; player-level kicks need a higher plan or another source.'
        );
      }
    } catch (err) {
      fail++;
      console.warn(`  normalize fail:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `[backfill-match-details] done: ok=${ok} fail=${fail} goals=${goalsTotal} penaltyKicks=${kicksTotal}`
  );

  const sample = getDb()
    .prepare(
      `SELECT m.id, m.duration, m.penalty_home, m.penalty_away,
              (SELECT COUNT(*) FROM match_penalty_kicks pk WHERE pk.match_id = m.id) AS kicks,
              (SELECT COUNT(*) FROM match_goals g WHERE g.match_id = m.id AND g.goal_type = 'PENALTY') AS pen_goals
       FROM matches m
       WHERE m.details_fetched_at IS NOT NULL
       ORDER BY m.details_fetched_at DESC
       LIMIT 5`
    )
    .all();
  console.table(sample);

  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
