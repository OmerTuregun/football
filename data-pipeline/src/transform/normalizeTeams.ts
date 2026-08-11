import { getDb } from '../db/client';

interface Area {
  id?: number;
  name?: string;
  code?: string;
  flag?: string;
}

interface TeamRaw {
  id: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
  address?: string;
  website?: string;
  founded?: number;
  clubColors?: string;
  venue?: string;
  area?: Area;
}

interface TeamsResponse {
  teams: TeamRaw[];
}

export function ensureTeamStub(team: {
  id: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}): void {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM teams WHERE id = ?').get(team.id);
  if (!exists) {
    db.prepare(`
      INSERT INTO teams (id, name, short_name, tla, crest)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(team.id, team.name ?? `Team ${team.id}`, team.shortName ?? null, team.tla ?? null, team.crest ?? null);
  }
}

export function normalizeTeams(data: TeamsResponse): number {
  const db = getDb();
  const now = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO teams (id, name, short_name, tla, crest, address, website, founded, club_colors, venue,
                       area_id, area_name, area_code, area_flag, updated_at)
    VALUES (@id, @name, @short_name, @tla, @crest, @address, @website, @founded, @club_colors, @venue,
            @area_id, @area_name, @area_code, @area_flag, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      short_name = excluded.short_name,
      tla = excluded.tla,
      crest = excluded.crest,
      address = excluded.address,
      website = excluded.website,
      founded = excluded.founded,
      club_colors = excluded.club_colors,
      venue = excluded.venue,
      area_id = excluded.area_id,
      area_name = excluded.area_name,
      area_code = excluded.area_code,
      area_flag = excluded.area_flag,
      updated_at = excluded.updated_at
  `);

  const insertAll = db.transaction((teams: TeamRaw[]) => {
    for (const team of teams) {
      upsert.run({
        id: team.id,
        name: team.name ?? `Team ${team.id}`,
        short_name: team.shortName ?? null,
        tla: team.tla ?? null,
        crest: team.crest ?? null,
        address: team.address ?? null,
        website: team.website ?? null,
        founded: team.founded ?? null,
        club_colors: team.clubColors ?? null,
        venue: team.venue ?? null,
        area_id: team.area?.id ?? null,
        area_name: team.area?.name ?? null,
        area_code: team.area?.code ?? null,
        area_flag: team.area?.flag ?? null,
        updated_at: now,
      });
    }
    return teams.length;
  });

  return insertAll(data.teams ?? []);
}
