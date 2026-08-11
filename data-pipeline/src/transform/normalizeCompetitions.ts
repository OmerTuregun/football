import { getDb } from '../db/client';
import { seasonYearFromDate } from '../utils';

interface Area {
  id?: number;
  name?: string;
  code?: string;
  flag?: string;
}

interface SeasonRaw {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday?: number | null;
  winner?: { id: number } | null;
  stages?: string[];
}

interface CompetitionRaw {
  id: number;
  name: string;
  code?: string;
  type?: string;
  emblem?: string;
  area?: Area;
  currentSeason?: SeasonRaw;
  seasons?: SeasonRaw[];
}

export function normalizeCompetitions(data: CompetitionRaw): { competitions: number; seasons: number } {
  const db = getDb();
  const now = new Date().toISOString();

  const upsertCompetition = db.prepare(`
    INSERT INTO competitions (id, name, code, type, emblem, area_id, area_name, area_code, area_flag, updated_at)
    VALUES (@id, @name, @code, @type, @emblem, @area_id, @area_name, @area_code, @area_flag, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      code = excluded.code,
      type = excluded.type,
      emblem = excluded.emblem,
      area_id = excluded.area_id,
      area_name = excluded.area_name,
      area_code = excluded.area_code,
      area_flag = excluded.area_flag,
      updated_at = excluded.updated_at
  `);

  const upsertSeason = db.prepare(`
    INSERT INTO seasons (id, competition_id, start_date, end_date, current_matchday, winner_team_id, stages, season_year, updated_at)
    VALUES (@id, @competition_id, @start_date, @end_date, @current_matchday, @winner_team_id, @stages, @season_year, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      competition_id = excluded.competition_id,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      current_matchday = excluded.current_matchday,
      winner_team_id = excluded.winner_team_id,
      stages = excluded.stages,
      season_year = excluded.season_year,
      updated_at = excluded.updated_at
  `);

  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?');

  function resolveWinnerTeamId(winnerId: number | null | undefined): number | null {
    if (winnerId == null) return null;
    return teamExists.get(winnerId) ? winnerId : null;
  }

  upsertCompetition.run({
    id: data.id,
    name: data.name,
    code: data.code ?? null,
    type: data.type ?? null,
    emblem: data.emblem ?? null,
    area_id: data.area?.id ?? null,
    area_name: data.area?.name ?? null,
    area_code: data.area?.code ?? null,
    area_flag: data.area?.flag ?? null,
    updated_at: now,
  });

  let seasonCount = 0;
  const seasonsToProcess = data.seasons ?? (data.currentSeason ? [data.currentSeason] : []);

  const insertSeasons = db.transaction((seasons: SeasonRaw[]) => {
    for (const season of seasons) {
      upsertSeason.run({
        id: season.id,
        competition_id: data.id,
        start_date: season.startDate,
        end_date: season.endDate,
        current_matchday: season.currentMatchday ?? null,
        winner_team_id: resolveWinnerTeamId(season.winner?.id),
        stages: season.stages ? JSON.stringify(season.stages) : null,
        season_year: seasonYearFromDate(season.startDate),
        updated_at: now,
      });
      seasonCount++;
    }
  });

  insertSeasons(seasonsToProcess);

  return { competitions: 1, seasons: seasonCount };
}

export function getCurrentSeasonYear(data: CompetitionRaw): number {
  if (data.currentSeason?.startDate) {
    return seasonYearFromDate(data.currentSeason.startDate);
  }
  if (data.seasons?.length) {
    const sorted = [...data.seasons].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
    return seasonYearFromDate(sorted[0].startDate);
  }
  throw new Error('Could not determine current season year from competition data');
}

export function getCurrentSeasonId(data: CompetitionRaw): number {
  if (data.currentSeason?.id) return data.currentSeason.id;
  if (data.seasons?.length) {
    const sorted = [...data.seasons].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
    return sorted[0].id;
  }
  throw new Error('Could not determine current season id from competition data');
}

export function getSeasonIdForYear(data: CompetitionRaw, year: number): number {
  const seasons = data.seasons ?? [];
  const match = seasons.find((season) => seasonYearFromDate(season.startDate) === year);
  if (match) return match.id;
  throw new Error(`Could not find season id for year ${year} in competition data`);
}
