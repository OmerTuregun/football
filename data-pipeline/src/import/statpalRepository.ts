import Database from 'better-sqlite3';
import { normalizeForSearch } from '../utils/normalizeSearch';
import type { StatPalCompetitionCode, StatPalPhase } from '../config/statpalMapping';
import { STATPAL_LEAGUE_EMBLEMS, seasonStartYear } from '../config/statpalMapping';

export interface FetchStateRow {
  status: string;
  cursor_json: string | null;
}

export interface ImportStats {
  teams: number;
  players: number;
  transfers: number;
  trophies: number;
  matches: number;
  lineups: number;
  teammatePairs: number;
}

export function emptyImportStats(): ImportStats {
  return {
    teams: 0,
    players: 0,
    transfers: 0,
    trophies: 0,
    matches: 0,
    lineups: 0,
    teammatePairs: 0,
  };
}

export class StatPalRepository {
  constructor(private readonly db: Database.Database) {}

  getFetchState(code: string, season: string, phase: StatPalPhase): FetchStateRow | undefined {
    return this.db
      .prepare(
        `SELECT status, cursor_json FROM statpal_fetch_state
         WHERE competition_code = ? AND season = ? AND phase = ?`
      )
      .get(code, season, phase) as FetchStateRow | undefined;
  }

  setFetchState(
    code: string,
    season: string,
    phase: StatPalPhase,
    status: 'pending' | 'partial' | 'done',
    cursor: unknown = null
  ): void {
    this.db
      .prepare(
        `INSERT INTO statpal_fetch_state (competition_code, season, phase, status, cursor_json, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(competition_code, season, phase) DO UPDATE SET
           status = excluded.status,
           cursor_json = excluded.cursor_json,
           updated_at = datetime('now')`
      )
      .run(code, season, phase, status, cursor ? JSON.stringify(cursor) : null);
  }

  ensureCompetition(code: StatPalCompetitionCode, name: string): number {
    const emblem = STATPAL_LEAGUE_EMBLEMS[code] ?? null;
    const existing = this.db
      .prepare('SELECT id FROM competitions WHERE code = ?')
      .get(code) as { id: number } | undefined;
    if (existing) {
      if (emblem) {
        this.db
          .prepare(
            `UPDATE competitions
             SET emblem = ?, updated_at = datetime('now')
             WHERE code = ? AND (emblem IS NULL OR trim(emblem) = '')`
          )
          .run(emblem, code);
      }
      return existing.id;
    }

    const maxId =
      (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM competitions').get() as { m: number }).m + 1;
    this.db
      .prepare(
        `INSERT INTO competitions (id, name, code, type, emblem, updated_at)
         VALUES (?, ?, ?, 'LEAGUE', ?, datetime('now'))`
      )
      .run(maxId, name, code, emblem);
    return maxId;
  }

  ensureSeason(competitionId: number, seasonLabel: string): number {
    const year = seasonStartYear(seasonLabel);
    const existing = this.db
      .prepare('SELECT id FROM seasons WHERE competition_id = ? AND season_year = ?')
      .get(competitionId, year) as { id: number } | undefined;
    if (existing) return existing.id;

    const maxId =
      (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM seasons').get() as { m: number }).m + 1;
    this.db
      .prepare(
        `INSERT INTO seasons (id, competition_id, season_year, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(maxId, competitionId, year);
    return maxId;
  }

  upsertTeam(statpalId: string, name: string, country?: string, venue?: string): number {
    const found = this.db
      .prepare('SELECT id FROM teams WHERE statpal_id = ?')
      .get(statpalId) as { id: number } | undefined;
    if (found) {
      this.db
        .prepare(
          `UPDATE teams SET name = ?, area_name = COALESCE(?, area_name), venue = COALESCE(?, venue), updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(name, country ?? null, venue ?? null, found.id);
      return found.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO teams (statpal_id, name, area_name, venue, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(statpalId, name, country ?? null, venue ?? null);
    return Number(result.lastInsertRowid);
  }

  upsertPlayer(
    statpalId: string,
    name: string,
    fields: {
      firstName?: string;
      lastName?: string;
      birthdate?: string;
      nationality?: string;
      position?: string;
      marketValueEur?: number | null;
    }
  ): number {
    const found = this.db
      .prepare('SELECT id FROM players WHERE statpal_id = ?')
      .get(statpalId) as { id: number } | undefined;
    const nameSearch = normalizeForSearch(name);

    if (found) {
      this.db
        .prepare(
          `UPDATE players SET
             name = ?, name_search = ?,
             first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             date_of_birth = COALESCE(?, date_of_birth),
             nationality = COALESCE(?, nationality),
             position = COALESCE(?, position),
             market_value_eur = COALESCE(?, market_value_eur),
             updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          name,
          nameSearch,
          fields.firstName ?? null,
          fields.lastName ?? null,
          fields.birthdate ?? null,
          fields.nationality ?? null,
          fields.position ?? null,
          fields.marketValueEur ?? null,
          found.id
        );
      return found.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO players (statpal_id, name, name_search, first_name, last_name, date_of_birth, nationality, position, market_value_eur, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        statpalId,
        name,
        nameSearch,
        fields.firstName ?? null,
        fields.lastName ?? null,
        fields.birthdate ?? null,
        fields.nationality ?? null,
        fields.position ?? null,
        fields.marketValueEur ?? null
      );
    return Number(result.lastInsertRowid);
  }

  isPlayerFetched(statpalPlayerId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM statpal_fetched_players WHERE statpal_player_id = ?')
        .get(statpalPlayerId)
    );
  }

  markPlayerFetched(statpalPlayerId: string, playerId: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO statpal_fetched_players (statpal_player_id, player_id)
         VALUES (?, ?)`
      )
      .run(statpalPlayerId, playerId);
  }

  upsertPlayerSeasonStats(
    playerId: number,
    teamId: number,
    seasonId: number,
    competitionId: number,
    statpalSeason: string,
    statpalLeagueId: string,
    row: Record<string, number | null | undefined>
  ): void {
    this.db
      .prepare(
        `INSERT INTO player_season_stats (
           player_id, team_id, season_id, competition_id,
           shirt_number, market_value, appearances, goals, assists,
           yellow_cards, red_cards, minutes_played,
           key_passes, pass_attempts, pass_success, tackles,
           duels_total, duels_won, dribble_attempts, dribble_success,
           rating, starting_lineups, substitute_in,
           stat_source, statpal_league_id, statpal_season, updated_at
         ) VALUES (
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           'statpal', ?, ?, datetime('now')
         )
         ON CONFLICT(player_id, team_id, season_id, competition_id) DO UPDATE SET
           appearances = COALESCE(excluded.appearances, player_season_stats.appearances),
           goals = COALESCE(excluded.goals, player_season_stats.goals),
           assists = COALESCE(excluded.assists, player_season_stats.assists),
           minutes_played = COALESCE(excluded.minutes_played, player_season_stats.minutes_played),
           yellow_cards = COALESCE(excluded.yellow_cards, player_season_stats.yellow_cards),
           red_cards = COALESCE(excluded.red_cards, player_season_stats.red_cards),
           key_passes = COALESCE(excluded.key_passes, player_season_stats.key_passes),
           pass_attempts = COALESCE(excluded.pass_attempts, player_season_stats.pass_attempts),
           pass_success = COALESCE(excluded.pass_success, player_season_stats.pass_success),
           tackles = COALESCE(excluded.tackles, player_season_stats.tackles),
           duels_total = COALESCE(excluded.duels_total, player_season_stats.duels_total),
           duels_won = COALESCE(excluded.duels_won, player_season_stats.duels_won),
           dribble_attempts = COALESCE(excluded.dribble_attempts, player_season_stats.dribble_attempts),
           dribble_success = COALESCE(excluded.dribble_success, player_season_stats.dribble_success),
           rating = COALESCE(excluded.rating, player_season_stats.rating),
           starting_lineups = COALESCE(excluded.starting_lineups, player_season_stats.starting_lineups),
           substitute_in = COALESCE(excluded.substitute_in, player_season_stats.substitute_in),
           stat_source = 'statpal',
           statpal_league_id = excluded.statpal_league_id,
           statpal_season = excluded.statpal_season,
           updated_at = datetime('now')`
      )
      .run(
        playerId,
        teamId,
        seasonId,
        competitionId,
        row.shirt_number ?? null,
        row.market_value ?? null,
        row.appearances ?? 0,
        row.goals ?? 0,
        row.assists ?? 0,
        row.yellow_cards ?? 0,
        row.red_cards ?? 0,
        row.minutes_played ?? 0,
        row.key_passes ?? null,
        row.pass_attempts ?? null,
        row.pass_success ?? null,
        row.tackles ?? null,
        row.duels_total ?? null,
        row.duels_won ?? null,
        row.dribble_attempts ?? null,
        row.dribble_success ?? null,
        row.rating ?? null,
        row.starting_lineups ?? null,
        row.substitute_in ?? null,
        statpalLeagueId,
        statpalSeason
      );
  }

  replacePlayerTrophies(playerId: number, trophies: Array<Record<string, unknown>>): number {
    this.db.prepare(`DELETE FROM player_trophies WHERE player_id = ? AND source = 'statpal'`).run(playerId);
    const insert = this.db.prepare(
      `INSERT INTO player_trophies (player_id, country, league, status, trophy_count, seasons, source)
       VALUES (?, ?, ?, ?, ?, ?, 'statpal')`
    );
    let n = 0;
    for (const t of trophies) {
      insert.run(
        playerId,
        (t.country as string) ?? null,
        (t.league as string) ?? null,
        (t.status as string) ?? null,
        parseInt(String(t.count ?? t.trophy_count ?? 0), 10) || 0,
        typeof t.seasons === 'string' ? t.seasons : JSON.stringify(t.seasons ?? null)
      );
      n += 1;
    }
    return n;
  }

  insertTransfer(
    playerId: number,
    transfer: {
      date?: string;
      type?: string;
      price?: string;
      from?: string;
      fromId?: string;
      to?: string;
      toId?: string;
    },
    seasonYear?: number
  ): boolean {
    const duplicate = this.db
      .prepare(
        `SELECT id FROM transfers
         WHERE player_id = ?
           AND IFNULL(transfer_date, '') = IFNULL(?, '')
           AND IFNULL(statpal_from_id, '') = IFNULL(?, '')
           AND IFNULL(statpal_to_id, '') = IFNULL(?, '')
         LIMIT 1`
      )
      .get(playerId, transfer.date ?? null, transfer.fromId ?? null, transfer.toId ?? null);
    if (duplicate) return false;

    const fromTeamId = transfer.fromId
      ? this.db.prepare('SELECT id FROM teams WHERE statpal_id = ?').get(transfer.fromId) as
          | { id: number }
          | undefined
      : undefined;
    const toTeamId = transfer.toId
      ? this.db.prepare('SELECT id FROM teams WHERE statpal_id = ?').get(transfer.toId) as
          | { id: number }
          | undefined
      : undefined;

    this.db
      .prepare(
        `INSERT INTO transfers (
           player_id, from_team_id, to_team_id, transfer_date, transfer_type,
           fee_amount, price, from_team_name, to_team_name, statpal_from_id, statpal_to_id, season_year, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        playerId,
        fromTeamId?.id ?? null,
        toTeamId?.id ?? null,
        transfer.date ?? null,
        transfer.type ?? null,
        parseFeeAmount(transfer.price),
        transfer.price ?? null,
        transfer.from ?? null,
        transfer.to ?? null,
        transfer.fromId ?? null,
        transfer.toId ?? null,
        seasonYear ?? null
      );
    return true;
  }

  getMatchIdByStatpalId(statpalMatchId: string): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM matches WHERE statpal_id = ?')
      .get(statpalMatchId) as { id: number } | undefined;
    return row?.id;
  }

  upsertMatch(
    statpalMatchId: string,
    competitionId: number,
    seasonId: number,
    homeTeamId: number,
    awayTeamId: number,
    fields: {
      date?: string;
      status?: string;
      homeScore?: number | null;
      awayScore?: number | null;
      venue?: string;
    }
  ): number {
    const found = this.db
      .prepare('SELECT id FROM matches WHERE statpal_id = ?')
      .get(statpalMatchId) as { id: number } | undefined;
    if (found) {
      this.db
        .prepare(
          `UPDATE matches SET
             utc_date = COALESCE(?, utc_date),
             status = COALESCE(?, status),
             home_score = COALESCE(?, home_score),
             away_score = COALESCE(?, away_score),
             venue = COALESCE(?, venue),
             updated_at = datetime('now')
           WHERE id = ?`
        )
        .run(
          fields.date ?? null,
          fields.status ?? null,
          fields.homeScore ?? null,
          fields.awayScore ?? null,
          fields.venue ?? null,
          found.id
        );
      return found.id;
    }

    const result = this.db
      .prepare(
        `INSERT INTO matches (
           statpal_id, competition_id, season_id, utc_date, status,
           home_team_id, away_team_id, home_score, away_score, venue, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        statpalMatchId,
        competitionId,
        seasonId,
        fields.date ?? null,
        fields.status ?? null,
        homeTeamId,
        awayTeamId,
        fields.homeScore ?? null,
        fields.awayScore ?? null,
        fields.venue ?? null
      );
    return Number(result.lastInsertRowid);
  }

  upsertLineupPlayer(
    matchId: number,
    teamId: number,
    playerId: number,
    position: string | null,
    shirtNumber: number | null,
    isStarter: boolean
  ): void {
    this.db
      .prepare(
        `INSERT INTO match_lineups (match_id, team_id, player_id, position, shirt_number, is_starter)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(match_id, team_id, player_id) DO UPDATE SET
           position = excluded.position,
           shirt_number = excluded.shirt_number,
           is_starter = excluded.is_starter`
      )
      .run(matchId, teamId, playerId, position, shirtNumber, isStarter ? 1 : 0);
  }

  computeTeammatesForSeason(seasonId: number): number {
    const result = this.db
      .prepare(
        `INSERT OR REPLACE INTO player_teammates (player_a_id, player_b_id, shared_matches, updated_at)
         SELECT
           ml1.player_id AS player_a_id,
           ml2.player_id AS player_b_id,
           COUNT(DISTINCT ml1.match_id) AS shared_matches,
           datetime('now')
         FROM match_lineups ml1
         JOIN match_lineups ml2
           ON ml1.match_id = ml2.match_id
          AND ml1.team_id = ml2.team_id
          AND ml1.player_id < ml2.player_id
         JOIN matches m ON m.id = ml1.match_id
         WHERE m.season_id = ?
         GROUP BY ml1.player_id, ml2.player_id`
      )
      .run(seasonId);
    return result.changes;
  }
}

function parseFeeAmount(price?: string): number | null {
  if (!price) return null;
  const digits = price.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function parseIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

export function parseFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

export function parseBirthdate(ddmmyyyy?: string): string | null {
  if (!ddmmyyyy) return null;
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return ddmmyyyy;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function parseMatchDate(ddmmyyyy?: string, time?: string): string | null {
  if (!ddmmyyyy) return null;
  const m = ddmmyyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const isoDate = `${m[3]}-${m[2]}-${m[1]}`;
  return time ? `${isoDate}T${time}:00` : isoDate;
}

/** Walk StatPal matches tree and collect match objects. */
export function collectMatchesFromPayload(payload: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.main_id && obj.home && obj.away) {
      out.push(obj);
      return;
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(payload);
  return out;
}

export function collectTeamIdsFromMatches(matches: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const m of matches) {
    const home = m.home as Record<string, unknown> | undefined;
    const away = m.away as Record<string, unknown> | undefined;
    if (home?.id) ids.add(String(home.id));
    if (away?.id) ids.add(String(away.id));
  }
  return ids;
}

export function collectUniqueDates(matches: Array<Record<string, unknown>>): string[] {
  const dates = new Set<string>();
  for (const m of matches) {
    if (m.date) dates.add(String(m.date));
  }
  return [...dates].sort();
}
