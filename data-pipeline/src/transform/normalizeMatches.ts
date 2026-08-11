import { getDb } from '../db/client';
import { ensureTeamStub } from './normalizeTeams';

interface TeamRef {
  id?: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface Score {
  winner?: string | null;
  duration?: string | null;
  fullTime?: { home?: number | null; away?: number | null };
  halfTime?: { home?: number | null; away?: number | null };
  regularTime?: { home?: number | null; away?: number | null };
  extraTime?: { home?: number | null; away?: number | null };
  penalties?: { home?: number | null; away?: number | null };
}

interface MatchRaw {
  id: number;
  utcDate?: string;
  status?: string;
  matchday?: number | null;
  stage?: string;
  group?: string | null;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  score?: Score;
  venue?: string;
  attendance?: number | null;
  minute?: number | null;
  injuryTime?: number | null;
  lastUpdated?: string;
  season?: { id: number };
  competition?: { id: number };
}

interface MatchesResponse {
  matches: MatchRaw[];
}

export function normalizeMatches(data: MatchesResponse): number {
  const db = getDb();
  const now = new Date().toISOString();
  const matches = data.matches ?? [];

  const upsert = db.prepare(`
    INSERT INTO matches (id, competition_id, season_id, utc_date, status, matchday, stage, group_name,
                         home_team_id, away_team_id, home_score, away_score, winner, venue, attendance,
                         minute, injury_time, last_updated,
                         duration, regular_home, regular_away, extra_home, extra_away,
                         penalty_home, penalty_away, updated_at)
    VALUES (@id, @competition_id, @season_id, @utc_date, @status, @matchday, @stage, @group_name,
            @home_team_id, @away_team_id, @home_score, @away_score, @winner, @venue, @attendance,
            @minute, @injury_time, @last_updated,
            @duration, @regular_home, @regular_away, @extra_home, @extra_away,
            @penalty_home, @penalty_away, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      competition_id = excluded.competition_id,
      season_id = excluded.season_id,
      utc_date = excluded.utc_date,
      status = excluded.status,
      matchday = excluded.matchday,
      stage = excluded.stage,
      group_name = excluded.group_name,
      home_team_id = excluded.home_team_id,
      away_team_id = excluded.away_team_id,
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      winner = excluded.winner,
      venue = excluded.venue,
      attendance = excluded.attendance,
      minute = excluded.minute,
      injury_time = excluded.injury_time,
      last_updated = excluded.last_updated,
      duration = COALESCE(excluded.duration, matches.duration),
      regular_home = COALESCE(excluded.regular_home, matches.regular_home),
      regular_away = COALESCE(excluded.regular_away, matches.regular_away),
      extra_home = COALESCE(excluded.extra_home, matches.extra_home),
      extra_away = COALESCE(excluded.extra_away, matches.extra_away),
      penalty_home = COALESCE(excluded.penalty_home, matches.penalty_home),
      penalty_away = COALESCE(excluded.penalty_away, matches.penalty_away),
      updated_at = excluded.updated_at
  `);

  const insertAll = db.transaction((items: MatchRaw[]) => {
    let count = 0;
    for (const match of items) {
      if (match.homeTeam?.id == null || match.awayTeam?.id == null) {
        console.warn(`[skip] match ${match.id}: team not yet determined`);
        continue;
      }

      const homeTeamId = match.homeTeam.id;
      const awayTeamId = match.awayTeam.id;

      ensureTeamStub({ ...match.homeTeam, id: homeTeamId });
      ensureTeamStub({ ...match.awayTeam, id: awayTeamId });

      upsert.run({
        id: match.id,
        competition_id: match.competition?.id,
        season_id: match.season?.id,
        utc_date: match.utcDate ?? null,
        status: match.status ?? null,
        matchday: match.matchday ?? null,
        stage: match.stage ?? null,
        group_name: match.group ?? null,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        home_score: match.score?.fullTime?.home ?? null,
        away_score: match.score?.fullTime?.away ?? null,
        winner: match.score?.winner ?? null,
        venue: match.venue ?? null,
        attendance: match.attendance ?? null,
        minute: match.minute ?? null,
        injury_time: match.injuryTime ?? null,
        last_updated: match.lastUpdated ?? null,
        duration: match.score?.duration ?? null,
        regular_home: match.score?.regularTime?.home ?? null,
        regular_away: match.score?.regularTime?.away ?? null,
        extra_home: match.score?.extraTime?.home ?? null,
        extra_away: match.score?.extraTime?.away ?? null,
        penalty_home: match.score?.penalties?.home ?? null,
        penalty_away: match.score?.penalties?.away ?? null,
        updated_at: now,
      });
      count++;
    }
    return count;
  });

  return insertAll(matches);
}
