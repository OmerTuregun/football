import { STATPAL_LEAGUES, getLeagueByCode } from '../config/statpalMapping';
import {
  StatPalRepository,
  parseBirthdate,
  parseFloatOrNull,
  parseIntOrNull,
} from '../import/statpalRepository';

function mapStatRow(row: Record<string, unknown>): Record<string, number | null> {
  return {
    appearances: parseIntOrNull(row.appearances ?? row.appearences),
    goals: parseIntOrNull(row.goals),
    assists: parseIntOrNull(row.assists),
    minutes_played: parseIntOrNull(row.minutes_played),
    yellow_cards: parseIntOrNull(row.yellowcards ?? row.yellow_cards),
    red_cards: parseIntOrNull(row.redcards ?? row.red_cards),
    key_passes: parseIntOrNull(row.key_passes),
    pass_attempts: parseIntOrNull(row.pass_attempts),
    pass_success: parseIntOrNull(row.pass_success),
    tackles: parseIntOrNull(row.tackles),
    duels_total: parseIntOrNull(row.duels_total),
    duels_won: parseIntOrNull(row.duels_won),
    dribble_attempts: parseIntOrNull(row.dribble_attempts),
    dribble_success: parseIntOrNull(row.dribble_success),
    rating: parseFloatOrNull(row.rating),
    starting_lineups: parseIntOrNull(row.starting_lineups),
    substitute_in: parseIntOrNull(row.substitute_in),
  };
}

function leagueByStatPalId(leagueId: string) {
  return STATPAL_LEAGUES.find((l) => l.leagueId === leagueId);
}

/** Known StatPal league id → competition code (for cleanup). */
export function expectedLeagueIdByCode(code: string): string | undefined {
  return getLeagueByCode(code)?.leagueId;
}

export interface IngestStatPalPlayerResult {
  playerId: number;
  statsRows: number;
  skippedRows: number;
  transfers: number;
  trophies: number;
}

/**
 * Upsert a StatPal player profile and route each club stat row to the
 * competition that matches row.league_id. Unknown leagues (U18, Championship, …)
 * are skipped — never attached to the import context competition.
 */
export function ingestStatPalPlayer(
  repo: StatPalRepository,
  statpalPlayerId: string,
  p: Record<string, unknown>
): IngestStatPalPlayerResult {
  const playerId = repo.upsertPlayer(String(p.id ?? statpalPlayerId), String(p.name ?? 'Unknown'), {
    firstName: p.firstname ? String(p.firstname) : undefined,
    lastName: p.lastname ? String(p.lastname) : undefined,
    birthdate: parseBirthdate(p.birthdate ? String(p.birthdate) : undefined) ?? undefined,
    nationality: p.nationality ? String(p.nationality) : undefined,
    position: p.position ? String(p.position) : undefined,
    marketValueEur: parseIntOrNull(p.market_value_eur),
  });
  repo.markPlayerFetched(statpalPlayerId, playerId);

  let statsRows = 0;
  let skippedRows = 0;
  let transfers = 0;

  const statBlocks = [
    p.club_league_statistics,
    p.club_domestic_cup_statistics,
    p.club_intl_cup_statistics,
  ] as Array<{ club?: Array<Record<string, unknown>> } | undefined>;

  for (const block of statBlocks) {
    for (const row of block?.club ?? []) {
      const teamStatpalId = row.team_id ? String(row.team_id) : null;
      if (!teamStatpalId) {
        skippedRows += 1;
        continue;
      }

      const rowLeagueId = row.league_id != null ? String(row.league_id) : '';
      const league = rowLeagueId ? leagueByStatPalId(rowLeagueId) : undefined;
      if (!league) {
        skippedRows += 1;
        continue;
      }

      const rowSeason = row.season != null ? String(row.season) : '';
      if (!rowSeason || rowSeason.length < 4) {
        skippedRows += 1;
        continue;
      }

      const teamId = repo.upsertTeam(teamStatpalId, String(row.team_name ?? 'Unknown'));
      const competitionId = repo.ensureCompetition(league.code, league.statpalName);
      const seasonId = repo.ensureSeason(competitionId, rowSeason);

      repo.upsertPlayerSeasonStats(
        playerId,
        teamId,
        seasonId,
        competitionId,
        rowSeason,
        league.leagueId,
        mapStatRow(row)
      );
      statsRows += 1;
    }
  }

  for (const tr of (p.transfers as Array<Record<string, unknown>> | undefined) ?? []) {
    if (
      repo.insertTransfer(playerId, {
        date: tr.date ? String(tr.date) : undefined,
        type: tr.type ? String(tr.type) : undefined,
        price: tr.price ? String(tr.price) : undefined,
        from: tr.from ? String(tr.from) : undefined,
        fromId: tr.from_id ? String(tr.from_id) : undefined,
        to: tr.to ? String(tr.to) : undefined,
        toId: tr.to_id ? String(tr.to_id) : undefined,
      })
    ) {
      transfers += 1;
    }
  }

  const trophiesRaw = p.trophies;
  const trophyList: Array<Record<string, unknown>> = [];
  if (Array.isArray(trophiesRaw)) {
    trophyList.push(...trophiesRaw);
  } else if (trophiesRaw && typeof trophiesRaw === 'object') {
    for (const [key, val] of Object.entries(trophiesRaw as Record<string, unknown>)) {
      if (val && typeof val === 'object') {
        trophyList.push({ ...(val as Record<string, unknown>), league: key });
      }
    }
  }
  const trophies = repo.replacePlayerTrophies(playerId, trophyList);

  return { playerId, statsRows, skippedRows, transfers, trophies };
}
