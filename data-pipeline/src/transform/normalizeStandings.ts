import { getDb } from '../db/client';
import { ensureTeamStub } from './normalizeTeams';

interface TeamRef {
  id: number;
  name?: string;
  crest?: string;
}

interface StandingRow {
  position: number;
  team: TeamRef;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface StandingTable {
  stage?: string;
  type?: string;
  group?: string | null;
  table: StandingRow[];
}

interface StandingsResponse {
  standings?: StandingTable[];
  season?: { id: number };
}

export function normalizeStandings(data: StandingsResponse, seasonId?: number): number {
  const db = getDb();
  const now = new Date().toISOString();
  const resolvedSeasonId = seasonId ?? data.season?.id;

  if (!resolvedSeasonId) {
    console.warn('[normalizeStandings] No season_id available, skipping.');
    return 0;
  }

  const upsert = db.prepare(`
    INSERT INTO standings (season_id, team_id, position, played, won, draw, lost, points, goals_for, goals_against, stage, table_type, updated_at)
    VALUES (@season_id, @team_id, @position, @played, @won, @draw, @lost, @points, @goals_for, @goals_against, @stage, @table_type, @updated_at)
    ON CONFLICT(season_id, team_id, stage, table_type) DO UPDATE SET
      position = excluded.position,
      played = excluded.played,
      won = excluded.won,
      draw = excluded.draw,
      lost = excluded.lost,
      points = excluded.points,
      goals_for = excluded.goals_for,
      goals_against = excluded.goals_against,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  const tables = data.standings ?? [];

  const insertAll = db.transaction(() => {
    for (const standing of tables) {
      const tableType = standing.type ?? 'TOTAL';
      const stage = standing.stage ?? standing.group ?? null;

      for (const row of standing.table) {
        ensureTeamStub(row.team);

        upsert.run({
          season_id: resolvedSeasonId,
          team_id: row.team.id,
          position: row.position,
          played: row.playedGames,
          won: row.won,
          draw: row.draw,
          lost: row.lost,
          points: row.points,
          goals_for: row.goalsFor,
          goals_against: row.goalsAgainst,
          stage,
          table_type: tableType,
          updated_at: now,
        });
        count++;
      }
    }
  });

  insertAll();
  return count;
}
