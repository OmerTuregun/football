import { getDb } from '../db/client';
import { ensureTeamStub } from './normalizeTeams';
import { normalizeForSearch } from '../utils/normalizeSearch';

interface NamedRef {
  id?: number | null;
  name?: string | null;
}

interface ScoreNode {
  winner?: string | null;
  duration?: string | null;
  fullTime?: { home?: number | null; away?: number | null };
  halfTime?: { home?: number | null; away?: number | null };
  regularTime?: { home?: number | null; away?: number | null };
  extraTime?: { home?: number | null; away?: number | null };
  penalties?: { home?: number | null; away?: number | null };
}

export interface MatchDetailRaw {
  id: number;
  utcDate?: string;
  status?: string;
  matchday?: number | null;
  stage?: string;
  group?: string | null;
  homeTeam?: NamedRef & { shortName?: string; tla?: string; crest?: string };
  awayTeam?: NamedRef & { shortName?: string; tla?: string; crest?: string };
  score?: ScoreNode;
  venue?: string;
  attendance?: number | null;
  lastUpdated?: string;
  season?: { id?: number };
  competition?: { id?: number };
  goals?: Array<{
    minute?: number | null;
    injuryTime?: number | null;
    type?: string | null;
    team?: NamedRef;
    scorer?: NamedRef;
    assist?: NamedRef | null;
    score?: { home?: number | null; away?: number | null };
  }>;
  penalties?: Array<{
    player?: NamedRef;
    team?: NamedRef;
    scored?: boolean;
  }>;
}

export interface NormalizeMatchDetailResult {
  goals: number;
  penaltyKicks: number;
  duration: string | null;
}

function ensurePlayerStub(player: { id: number; name?: string | null }): void {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM players WHERE id = ?').get(player.id);
  if (exists) return;
  const name = player.name?.trim() || `Player ${player.id}`;
  db.prepare(
    `INSERT INTO players (id, name, name_search, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO NOTHING`
  ).run(player.id, name, normalizeForSearch(name));
}

function resolveTeamId(
  matchId: number,
  homeTeamId: number,
  awayTeamId: number,
  team: NamedRef | undefined,
  playerId: number | null
): number | null {
  if (team?.id != null) return team.id;

  if (playerId != null) {
    const lineup = getDb()
      .prepare(
        `SELECT team_id FROM match_lineups
         WHERE match_id = ? AND player_id = ?
         LIMIT 1`
      )
      .get(matchId, playerId) as { team_id: number } | undefined;
    if (lineup) return lineup.team_id;
  }

  // Fallback: leave null (team missing in API shootout payload)
  void homeTeamId;
  void awayTeamId;
  return null;
}

export function normalizeMatchDetail(match: MatchDetailRaw): NormalizeMatchDetailResult {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT id, home_team_id, away_team_id, competition_id, season_id
       FROM matches WHERE id = ?`
    )
    .get(match.id) as
    | {
        id: number;
        home_team_id: number;
        away_team_id: number;
        competition_id: number;
        season_id: number;
      }
    | undefined;

  if (!existing) {
    throw new Error(`match ${match.id} not found in DB — import match list first`);
  }

  const homeTeamId = match.homeTeam?.id ?? existing.home_team_id;
  const awayTeamId = match.awayTeam?.id ?? existing.away_team_id;

  if (match.homeTeam?.id != null) {
    ensureTeamStub({
      id: match.homeTeam.id,
      name: match.homeTeam.name ?? undefined,
      shortName: match.homeTeam.shortName,
      tla: match.homeTeam.tla,
      crest: match.homeTeam.crest,
    });
  }
  if (match.awayTeam?.id != null) {
    ensureTeamStub({
      id: match.awayTeam.id,
      name: match.awayTeam.name ?? undefined,
      shortName: match.awayTeam.shortName,
      tla: match.awayTeam.tla,
      crest: match.awayTeam.crest,
    });
  }

  const duration = match.score?.duration ?? null;
  const score = match.score;

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE matches SET
         utc_date = COALESCE(?, utc_date),
         status = COALESCE(?, status),
         matchday = COALESCE(?, matchday),
         stage = COALESCE(?, stage),
         group_name = COALESCE(?, group_name),
         home_team_id = ?,
         away_team_id = ?,
         home_score = COALESCE(?, home_score),
         away_score = COALESCE(?, away_score),
         winner = COALESCE(?, winner),
         venue = COALESCE(?, venue),
         attendance = COALESCE(?, attendance),
         last_updated = COALESCE(?, last_updated),
         duration = ?,
         regular_home = ?,
         regular_away = ?,
         extra_home = ?,
         extra_away = ?,
         penalty_home = ?,
         penalty_away = ?,
         details_fetched_at = ?,
         updated_at = ?
       WHERE id = ?`
    ).run(
      match.utcDate ?? null,
      match.status ?? null,
      match.matchday ?? null,
      match.stage ?? null,
      match.group ?? null,
      homeTeamId,
      awayTeamId,
      score?.fullTime?.home ?? null,
      score?.fullTime?.away ?? null,
      score?.winner ?? null,
      match.venue ?? null,
      match.attendance ?? null,
      match.lastUpdated ?? null,
      duration,
      score?.regularTime?.home ?? null,
      score?.regularTime?.away ?? null,
      score?.extraTime?.home ?? null,
      score?.extraTime?.away ?? null,
      score?.penalties?.home ?? null,
      score?.penalties?.away ?? null,
      now,
      now,
      match.id
    );

    db.prepare('DELETE FROM match_goals WHERE match_id = ?').run(match.id);
    db.prepare('DELETE FROM match_penalty_kicks WHERE match_id = ?').run(match.id);

    const insertGoal = db.prepare(
      `INSERT INTO match_goals (
         match_id, team_id, scorer_id, assist_id, minute, injury_time,
         goal_type, home_score_after, away_score_after, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'football-data')`
    );

    let goals = 0;
    for (const g of match.goals ?? []) {
      const teamId = g.team?.id;
      if (teamId == null) continue;
      ensureTeamStub({ id: teamId, name: g.team?.name ?? undefined });

      const scorerId = g.scorer?.id ?? null;
      if (scorerId != null) {
        ensurePlayerStub({ id: scorerId, name: g.scorer?.name });
      }
      const assistId = g.assist?.id ?? null;
      if (assistId != null) {
        ensurePlayerStub({ id: assistId, name: g.assist?.name });
      }

      const goalType = (g.type ?? 'REGULAR').toUpperCase();
      insertGoal.run(
        match.id,
        teamId,
        scorerId,
        assistId,
        g.minute ?? null,
        g.injuryTime ?? null,
        goalType,
        g.score?.home ?? null,
        g.score?.away ?? null
      );
      goals++;
    }

    const insertKick = db.prepare(
      `INSERT INTO match_penalty_kicks (
         match_id, team_id, player_id, kick_order, scored, source
       ) VALUES (?, ?, ?, ?, ?, 'football-data')`
    );

    let penaltyKicks = 0;
    const kicks = match.penalties ?? [];
    for (let i = 0; i < kicks.length; i++) {
      const kick = kicks[i];
      const playerId = kick.player?.id ?? null;
      if (playerId != null) {
        ensurePlayerStub({ id: playerId, name: kick.player?.name });
      }
      if (kick.team?.id != null) {
        ensureTeamStub({ id: kick.team.id, name: kick.team.name ?? undefined });
      }

      const teamId = resolveTeamId(
        match.id,
        homeTeamId,
        awayTeamId,
        kick.team,
        playerId
      );

      insertKick.run(
        match.id,
        teamId,
        playerId,
        i + 1,
        kick.scored ? 1 : 0
      );
      penaltyKicks++;
    }

    return { goals, penaltyKicks, duration };
  });

  return apply();
}
