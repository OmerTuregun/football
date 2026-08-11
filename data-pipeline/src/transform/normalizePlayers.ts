import { getDb } from '../db/client';
import { normalizeForSearch } from '../utils/normalizeSearch';

export interface SquadPlayer {
  id: number;
  name: string;
  position?: string;
  dateOfBirth?: string;
  nationality?: string;
}

export interface TeamWithSquad {
  id: number;
  squad?: SquadPlayer[];
}

export function normalizePlayers(
  teams: TeamWithSquad[],
  seasonId: number,
  competitionId: number
): { players: number; memberships: number; membershipsNew: number } {
  const db = getDb();
  const now = new Date().toISOString();

  const upsertPlayer = db.prepare(`
    INSERT INTO players (id, name, name_search, first_name, last_name, date_of_birth, nationality, position, updated_at)
    VALUES (@id, @name, @name_search, NULL, NULL, @date_of_birth, @nationality, @position, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      name_search = excluded.name_search,
      date_of_birth = excluded.date_of_birth,
      nationality = excluded.nationality,
      position = excluded.position,
      updated_at = excluded.updated_at
  `);

  const insertMembership = db.prepare(`
    INSERT INTO player_season_stats (player_id, team_id, season_id, competition_id)
    VALUES (@player_id, @team_id, @season_id, @competition_id)
    ON CONFLICT(player_id, team_id, season_id, competition_id) DO NOTHING
  `);

  let players = 0;
  let memberships = 0;
  let membershipsNew = 0;

  const insertAll = db.transaction((items: TeamWithSquad[]) => {
    for (const team of items) {
      for (const player of team.squad ?? []) {
        const playerName = player.name ?? `Player ${player.id}`;
        upsertPlayer.run({
          id: player.id,
          name: playerName,
          name_search: normalizeForSearch(playerName),
          date_of_birth: player.dateOfBirth ?? null,
          nationality: player.nationality ?? null,
          position: player.position ?? null,
          updated_at: now,
        });
        players++;

        const result = insertMembership.run({
          player_id: player.id,
          team_id: team.id,
          season_id: seasonId,
          competition_id: competitionId,
        });
        memberships++;
        if (result.changes > 0) membershipsNew++;
      }
    }
  });

  insertAll(teams);

  return { players, memberships, membershipsNew };
}
