/**
 * StatPal bulk import — resume-able, priority-ordered.
 * Usage: npm run statpal-import [-- --competition=CL] [-- --season=2024-2025]
 */
import { closeDb, getDb, runMigrations } from '../db/client';
import {
  STATPAL_LEAGUES,
  STATPAL_PHASES,
  STATPAL_TARGET_SEASONS,
  type StatPalLeagueConfig,
  type StatPalPhase,
  getLeagueByCode,
} from '../config/statpalMapping';
import {
  StatPalQuotaError,
  StatPalTransientError,
  STATPAL_DAILY_LIMIT,
  STATPAL_DAILY_STOP,
  getApiCallsThisSession,
  getLastKnownRequestCount,
  getLeagueMatches,
  getLeagueMatchesStatsByDate,
  getPlayer,
  getStatPalConcurrency,
  getTeam,
  getUserRequestCount,
} from '../fetch/statpalClient';
import {
  StatPalRepository,
  collectMatchesFromPayload,
  collectTeamIdsFromMatches,
  collectUniqueDates,
  emptyImportStats,
  parseBirthdate,
  parseFloatOrNull,
  parseIntOrNull,
  parseMatchDate,
  type ImportStats,
} from '../import/statpalRepository';
import { mapInPool, parseArgs } from '../utils';

interface PhaseCursor {
  teamIds?: string[];
  playerIds?: string[];
  matchIds?: string[];
  dates?: string[];
  teamIndex?: number;
  playerIndex?: number;
  dateIndex?: number;
  failedPlayerIds?: string[];
  failedDates?: string[];
}

interface SeasonContext {
  league: StatPalLeagueConfig;
  season: string;
  competitionId: number;
  seasonId: number;
  matchesPayload: unknown;
  allMatches: Array<Record<string, unknown>>;
}

const globalStats = emptyImportStats();
let stoppedByQuota = false;

function pct(done: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.min(100, Math.round((done / total) * 100))}%`;
}

function logProgress(phase: string, done: number, total: number, extra = ''): void {
  const bar = `[${phase}] ${done}/${total} (${pct(done, total)})`;
  const api = `sessionApi=${getApiCallsThisSession()} daily=${getLastKnownRequestCount() ?? '?'}`;
  console.log(`  ${bar}${extra ? ` ${extra}` : ''} | ${api}`);
}

function logSummary(label: string, stats: ImportStats): void {
  const used = getLastKnownRequestCount();
  const remaining = used !== null ? STATPAL_DAILY_LIMIT - used : '?';
  console.log(
    `\n[summary] ${label}: teams=${stats.teams} players=${stats.players} transfers=${stats.transfers} ` +
      `trophies=${stats.trophies} matches=${stats.matches} lineups=${stats.lineups} ` +
      `teammatePairs=${stats.teammatePairs} sessionApiCalls=${getApiCallsThisSession()} ` +
      `dailyUsed=${used ?? '?'} remaining=${remaining}`
  );
}

async function refreshQuota(): Promise<void> {
  try {
    const u = await getUserRequestCount();
    console.log(`[quota] ${u.current_date}: ${u.request_count} requests today`);
  } catch (err) {
    // VPN / gateway blips must not fail a finished import
    console.warn(
      `[quota] check skipped:`,
      err instanceof Error ? err.message.slice(0, 120) : err
    );
  }
}

async function loadSeasonContext(
  repo: StatPalRepository,
  league: StatPalLeagueConfig,
  season: string
): Promise<SeasonContext> {
  const competitionId = repo.ensureCompetition(league.code, league.statpalName);
  const seasonId = repo.ensureSeason(competitionId, season);
  const matchesPayload = await getLeagueMatches(league.leagueId, season);
  const allMatches = collectMatchesFromPayload(matchesPayload);
  return { league, season, competitionId, seasonId, matchesPayload, allMatches };
}

async function phaseTeams(
  ctx: SeasonContext,
  repo: StatPalRepository,
  cursor: PhaseCursor,
  onProgress: () => void
): Promise<void> {
  const teamIds = [...collectTeamIdsFromMatches(ctx.allMatches)];
  const concurrency = getStatPalConcurrency();
  console.log(`  [teams] ${teamIds.length} team id(s), concurrency=${concurrency}`);

  const start = cursor.teamIndex ?? 0;
  for (let i = start; i < teamIds.length; i += concurrency) {
    const chunk = teamIds.slice(i, i + concurrency);
    let ok = 0;
    let fail = 0;
    const results = await mapInPool(chunk, concurrency, async (teamId) => {
      try {
        const raw = (await getTeam(teamId)) as { team?: Record<string, unknown> };
        return { teamId, team: raw.team ?? null, error: null as string | null };
      } catch (err) {
        return {
          teamId,
          team: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    for (const result of results) {
      if (result.error || !result.team) {
        fail += 1;
        console.warn(`  [teams] skip team ${result.teamId}:`, result.error ?? 'empty');
        continue;
      }
      ok += 1;
      const team = result.team;
      repo.upsertTeam(
        String(team.id ?? result.teamId),
        String(team.name ?? 'Unknown'),
        team.country ? String(team.country) : undefined,
        team.venue_name ? String(team.venue_name) : undefined
      );
      globalStats.teams += 1;
      console.log(`  [teams] + ${team.name ?? result.teamId} (statpal=${result.teamId})`);

      const squad = team.squad as { player?: Array<Record<string, unknown>> } | undefined;
      const pendingPlayerIds = cursor.playerIds ?? [];
      for (const p of squad?.player ?? []) {
        if (p.id) pendingPlayerIds.push(String(p.id));
      }
      cursor.playerIds = [...new Set(pendingPlayerIds)];
    }

    cursor.teamIndex = i + chunk.length;
    logProgress('teams', cursor.teamIndex, teamIds.length, `batch ok=${ok} fail=${fail} squadPlayers=${cursor.playerIds?.length ?? 0}`);
    onProgress();
  }

  cursor.teamIds = teamIds;
  cursor.teamIndex = teamIds.length;
  onProgress();
}

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

function ingestPlayer(
  repo: StatPalRepository,
  ctx: SeasonContext,
  statpalPlayerId: string,
  p: Record<string, unknown>
): void {
  const playerId = repo.upsertPlayer(String(p.id ?? statpalPlayerId), String(p.name ?? 'Unknown'), {
    firstName: p.firstname ? String(p.firstname) : undefined,
    lastName: p.lastname ? String(p.lastname) : undefined,
    birthdate: parseBirthdate(p.birthdate ? String(p.birthdate) : undefined) ?? undefined,
    nationality: p.nationality ? String(p.nationality) : undefined,
    position: p.position ? String(p.position) : undefined,
    marketValueEur: parseIntOrNull(p.market_value_eur),
  });
  globalStats.players += 1;
  repo.markPlayerFetched(statpalPlayerId, playerId);

  const statBlocks = [
    p.club_league_statistics,
    p.club_domestic_cup_statistics,
    p.club_intl_cup_statistics,
  ] as Array<{ club?: Array<Record<string, unknown>> } | undefined>;

  for (const block of statBlocks) {
    for (const row of block?.club ?? []) {
      const teamStatpalId = row.team_id ? String(row.team_id) : null;
      if (!teamStatpalId) continue;
      const teamId = repo.upsertTeam(teamStatpalId, String(row.team_name ?? 'Unknown'));
      const rowSeason = String(row.season ?? ctx.season);
      if (rowSeason !== ctx.season && !rowSeason.includes(ctx.season.split('-')[0])) continue;

      repo.upsertPlayerSeasonStats(
        playerId,
        teamId,
        ctx.seasonId,
        ctx.competitionId,
        rowSeason,
        String(row.league_id ?? ctx.league.leagueId),
        mapStatRow(row)
      );
    }
  }

  const transfers = (p.transfers as Array<Record<string, unknown>> | undefined) ?? [];
  for (const tr of transfers) {
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
      globalStats.transfers += 1;
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
  globalStats.trophies += repo.replacePlayerTrophies(playerId, trophyList);
}

async function phasePlayers(
  ctx: SeasonContext,
  repo: StatPalRepository,
  cursor: PhaseCursor,
  onProgress: () => void
): Promise<void> {
  if (!cursor.playerIds?.length) {
    const teamsState = repo.getFetchState(ctx.league.code, ctx.season, 'teams');
    if (teamsState?.cursor_json) {
      const teamsCursor = JSON.parse(teamsState.cursor_json) as PhaseCursor;
      cursor.playerIds = teamsCursor.playerIds ?? [];
    }
  }

  const playerIds = cursor.playerIds ?? [];
  const concurrency = getStatPalConcurrency();
  const start = cursor.playerIndex ?? 0;
  cursor.failedPlayerIds = cursor.failedPlayerIds ?? [];
  console.log(
    `  [players] ${playerIds.length} player id(s), starting at ${start}, concurrency=${concurrency}`
  );

  for (let i = start; i < playerIds.length; i += concurrency) {
    const chunk = playerIds.slice(i, i + concurrency);
    const toFetch = chunk.filter((id) => !repo.isPlayerFetched(id));
    const already = chunk.length - toFetch.length;
    let ok = 0;
    let fail = 0;
    let deferred = 0;

    const results = await mapInPool(toFetch, concurrency, async (statpalPlayerId) => {
      try {
        const raw = (await getPlayer(statpalPlayerId)) as { player?: Record<string, unknown> };
        return { statpalPlayerId, player: raw.player ?? null, error: null as Error | null };
      } catch (err) {
        return {
          statpalPlayerId,
          player: null,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    });

    for (const result of results) {
      if (result.error) {
        const retryLater =
          result.error instanceof StatPalTransientError ||
          result.error.message.includes('504') ||
          result.error.message.includes('502') ||
          result.error.message.includes('503') ||
          result.error.message.includes('500');
        if (retryLater) {
          deferred += 1;
          if (!cursor.failedPlayerIds!.includes(result.statpalPlayerId)) {
            cursor.failedPlayerIds!.push(result.statpalPlayerId);
          }
          console.warn(`  [players] defer ${result.statpalPlayerId}: ${result.error.message.slice(0, 80)}`);
        } else {
          fail += 1;
          console.warn(`  [players] skip ${result.statpalPlayerId}: ${result.error.message.slice(0, 80)}`);
        }
        continue;
      }
      if (!result.player) {
        fail += 1;
        continue;
      }
      ingestPlayer(repo, ctx, result.statpalPlayerId, result.player);
      ok += 1;
      console.log(
        `  [players] + ${result.player.name ?? result.statpalPlayerId} (id=${result.statpalPlayerId})`
      );
    }

    cursor.playerIndex = i + chunk.length;
    logProgress(
      'players',
      cursor.playerIndex,
      playerIds.length,
      `ok=${ok} skipCached=${already} defer=${deferred} fail=${fail}`
    );
    onProgress();
  }

  const retryIds = [...new Set(cursor.failedPlayerIds ?? [])].filter((id) => !repo.isPlayerFetched(id));
  if (retryIds.length > 0) {
    console.log(`  [players] retrying ${retryIds.length} deferred player(s)`);
    for (let i = 0; i < retryIds.length; i += concurrency) {
      const chunk = retryIds.slice(i, i + concurrency);
      const results = await mapInPool(chunk, concurrency, async (statpalPlayerId) => {
        try {
          const raw = (await getPlayer(statpalPlayerId)) as { player?: Record<string, unknown> };
          return { statpalPlayerId, player: raw.player ?? null, error: null as Error | null };
        } catch (err) {
          return {
            statpalPlayerId,
            player: null,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      });
      for (const result of results) {
        if (result.error || !result.player) {
          console.warn(`  [players] still failed ${result.statpalPlayerId}`);
          continue;
        }
        ingestPlayer(repo, ctx, result.statpalPlayerId, result.player);
        cursor.failedPlayerIds = cursor.failedPlayerIds!.filter((id) => id !== result.statpalPlayerId);
      }
      onProgress();
    }
  }

  onProgress();
}

async function phaseMatches(ctx: SeasonContext, repo: StatPalRepository): Promise<void> {
  const total = ctx.allMatches.length;
  console.log(`  [matches] writing ${total} match(es) to DB (no extra API calls)`);
  let i = 0;
  for (const m of ctx.allMatches) {
    const statpalMatchId = String(m.main_id);
    const home = m.home as Record<string, unknown>;
    const away = m.away as Record<string, unknown>;
    if (!home?.id || !away?.id) continue;

    const homeTeamId = repo.upsertTeam(String(home.id), String(home.name ?? 'Home'));
    const awayTeamId = repo.upsertTeam(String(away.id), String(away.name ?? 'Away'));
    const mi = m.match_info as Record<string, unknown> | undefined;
    const stadium = mi?.stadium as Record<string, unknown> | undefined;

    repo.upsertMatch(statpalMatchId, ctx.competitionId, ctx.seasonId, homeTeamId, awayTeamId, {
      date: parseMatchDate(String(m.date ?? ''), m.time ? String(m.time) : undefined) ?? undefined,
      status: m.status ? String(m.status) : undefined,
      homeScore: parseIntOrNull(home.goals),
      awayScore: parseIntOrNull(away.goals),
      venue: stadium?.name ? String(stadium.name) : undefined,
    });
    globalStats.matches += 1;
    i += 1;
    if (i % 50 === 0 || i === total) {
      logProgress('matches', i, total, `${home.name} vs ${away.name}`);
    }
  }
}

/** StatPal lineup/bench side nodes are `{ player: [...] }` (sometimes a single object). */
function playersFromSideNode(sideNode: unknown): Array<Record<string, unknown>> {
  if (!sideNode || typeof sideNode !== 'object') return [];
  if (Array.isArray(sideNode)) {
    return sideNode.filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'));
  }
  const obj = sideNode as Record<string, unknown>;
  const players = obj.player;
  if (Array.isArray(players)) {
    return players.filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'));
  }
  if (players && typeof players === 'object') {
    return [players as Record<string, unknown>];
  }
  return [];
}

function saveLineupsFromMatch(
  repo: StatPalRepository,
  m: Record<string, unknown>,
  ctx: SeasonContext
): number {
  const statpalMatchId = String(m.main_id);
  const home = m.home as Record<string, unknown>;
  const away = m.away as Record<string, unknown>;
  if (!home?.id || !away?.id) return 0;

  let matchRowId = repo.getMatchIdByStatpalId(statpalMatchId);
  if (!matchRowId) {
    const homeTeamId = repo.upsertTeam(String(home.id), String(home.name ?? 'Home'));
    const awayTeamId = repo.upsertTeam(String(away.id), String(away.name ?? 'Away'));
    const mi = m.match_info as Record<string, unknown> | undefined;
    const stadium = mi?.stadium as Record<string, unknown> | undefined;
    matchRowId = repo.upsertMatch(statpalMatchId, ctx.competitionId, ctx.seasonId, homeTeamId, awayTeamId, {
      date: parseMatchDate(String(m.date ?? ''), m.time ? String(m.time) : undefined) ?? undefined,
      status: m.status ? String(m.status) : undefined,
      homeScore: parseIntOrNull(home.goals),
      awayScore: parseIntOrNull(away.goals),
      venue: stadium?.name ? String(stadium.name) : undefined,
    });
  }

  const homeTeamId = repo.upsertTeam(String(home.id), String(home.name ?? 'Home'));
  const awayTeamId = repo.upsertTeam(String(away.id), String(away.name ?? 'Away'));
  let count = 0;

  const lineups = m.lineups as Record<string, unknown> | undefined;
  if (!lineups) return 0;

  const benches = m.bench as Record<string, unknown> | undefined;

  for (const side of ['home', 'away'] as const) {
    const teamId = side === 'home' ? homeTeamId : awayTeamId;

    for (const pl of playersFromSideNode(lineups[side])) {
      if (!pl.id) continue;
      const playerId = repo.upsertPlayer(String(pl.id), String(pl.name ?? 'Unknown'), {
        position: pl.pos ? String(pl.pos) : undefined,
      });
      repo.upsertLineupPlayer(
        matchRowId,
        teamId,
        playerId,
        pl.pos ? String(pl.pos) : null,
        parseIntOrNull(pl.number),
        true
      );
      count += 1;
    }

    for (const pl of playersFromSideNode(benches?.[side])) {
      if (!pl.id) continue;
      const playerId = repo.upsertPlayer(String(pl.id), String(pl.name ?? 'Unknown'), {
        position: pl.pos ? String(pl.pos) : undefined,
      });
      repo.upsertLineupPlayer(
        matchRowId,
        teamId,
        playerId,
        pl.pos ? String(pl.pos) : null,
        parseIntOrNull(pl.number),
        false
      );
      count += 1;
    }
  }

  return count;
}

async function phaseLineups(
  ctx: SeasonContext,
  repo: StatPalRepository,
  cursor: PhaseCursor,
  onProgress: () => void
): Promise<void> {
  const dates = cursor.dates ?? collectUniqueDates(ctx.allMatches);
  cursor.dates = dates;
  cursor.failedDates = cursor.failedDates ?? [];
  const start = cursor.dateIndex ?? 0;
  const concurrency = Math.min(getStatPalConcurrency(), 4);
  console.log(`  [lineups] ${dates.length} unique match date(s), concurrency=${concurrency}`);

  const isSkippableServerError = (msg: string): boolean =>
    msg.includes('HTTP 500') ||
    msg.includes('HTTP 502') ||
    msg.includes('HTTP 503') ||
    msg.includes('HTTP 504') ||
    msg.includes('HTTP 429') ||
    msg.includes('Gateway Time-out') ||
    msg.includes('Internal Server Error') ||
    msg.includes('Unexpected token') ||
    msg.includes('non-JSON') ||
    msg.includes('<html');

  for (let i = start; i < dates.length; i += concurrency) {
    const chunk = dates.slice(i, i + concurrency);
    const results = await mapInPool(chunk, concurrency, async (date) => {
      try {
        const statsPayload = await getLeagueMatchesStatsByDate(ctx.league.leagueId, date);
        return { date, matches: collectMatchesFromPayload(statsPayload), error: null as string | null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('Not Found')) {
          return { date, matches: [] as Array<Record<string, unknown>>, error: null };
        }
        return { date, matches: [] as Array<Record<string, unknown>>, error: msg };
      }
    });

    for (const result of results) {
      if (result.error) {
        if (isSkippableServerError(result.error)) {
          if (!cursor.failedDates!.includes(result.date)) {
            cursor.failedDates!.push(result.date);
          }
          console.warn(`  [lineups] skip ${result.date}: ${result.error.slice(0, 100)}`);
          continue;
        }
        throw new Error(result.error);
      }
      let dayLineups = 0;
      if (result.matches.length === 0) {
        console.log(`  [lineups] no data for ${result.date}`);
      }
      for (const m of result.matches) {
        const n = saveLineupsFromMatch(repo, m, ctx);
        dayLineups += n;
        globalStats.lineups += n;
        const home = m.home as Record<string, unknown> | undefined;
        const away = m.away as Record<string, unknown> | undefined;
        console.log(
          `  [lineups] ${result.date} ${home?.name ?? '?'} vs ${away?.name ?? '?'} → ${n} players`
        );
      }
      if (result.matches.length > 0) {
        console.log(`  [lineups] date ${result.date}: ${result.matches.length} match(es), ${dayLineups} lineup rows`);
      }
    }

    cursor.dateIndex = i + chunk.length;
    logProgress(
      'lineups',
      cursor.dateIndex,
      dates.length,
      `failedDates=${cursor.failedDates?.length ?? 0}`
    );
    onProgress();
  }

  const retryDates = [...new Set(cursor.failedDates ?? [])];
  if (retryDates.length > 0) {
    console.log(`  [lineups] retrying ${retryDates.length} failed date(s)`);
    const stillFailed: string[] = [];
    for (let i = 0; i < retryDates.length; i += concurrency) {
      const chunk = retryDates.slice(i, i + concurrency);
      const results = await mapInPool(chunk, concurrency, async (date) => {
        try {
          const statsPayload = await getLeagueMatchesStatsByDate(ctx.league.leagueId, date);
          return { date, matches: collectMatchesFromPayload(statsPayload), error: null as string | null };
        } catch (err) {
          return {
            date,
            matches: [] as Array<Record<string, unknown>>,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });
      for (const result of results) {
        if (result.error || result.matches.length === 0) {
          stillFailed.push(result.date);
          console.warn(`  [lineups] still failed ${result.date}`);
          continue;
        }
        for (const m of result.matches) {
          globalStats.lineups += saveLineupsFromMatch(repo, m, ctx);
        }
      }
      onProgress();
    }
    cursor.failedDates = stillFailed;
    if (stillFailed.length > 0) {
      console.warn(
        `  [lineups] ${stillFailed.length} date(s) still missing after retry: ${stillFailed.join(', ')}`
      );
    }
  }

  onProgress();
}

async function phaseTeammates(ctx: SeasonContext, repo: StatPalRepository): Promise<void> {
  const pairs = repo.computeTeammatesForSeason(ctx.seasonId);
  globalStats.teammatePairs += pairs;
  console.log(`  [teammates] ${pairs} pair(s) upserted for season ${ctx.season}`);
}

async function runPhase(
  phase: StatPalPhase,
  ctx: SeasonContext,
  repo: StatPalRepository
): Promise<'done' | 'partial'> {
  const existing = repo.getFetchState(ctx.league.code, ctx.season, phase);
  if (existing?.status === 'done') {
    console.log(`  [skip] ${phase} already done`);
    return 'done';
  }

  const cursor: PhaseCursor = existing?.cursor_json ? JSON.parse(existing.cursor_json) : {};

  console.log(`\n  >> phase ${phase}`);
  repo.setFetchState(ctx.league.code, ctx.season, phase, 'partial', cursor);

  const saveProgress = (): void => {
    repo.setFetchState(ctx.league.code, ctx.season, phase, 'partial', cursor);
  };

  try {
    switch (phase) {
      case 'teams':
        await phaseTeams(ctx, repo, cursor, saveProgress);
        break;
      case 'players':
        await phasePlayers(ctx, repo, cursor, saveProgress);
        break;
      case 'matches':
        await phaseMatches(ctx, repo);
        break;
      case 'lineups':
        await phaseLineups(ctx, repo, cursor, saveProgress);
        break;
      case 'teammates':
        await phaseTeammates(ctx, repo);
        break;
    }
    repo.setFetchState(ctx.league.code, ctx.season, phase, 'done', cursor);
    return 'done';
  } catch (err) {
    if (err instanceof StatPalQuotaError) {
      repo.setFetchState(ctx.league.code, ctx.season, phase, 'partial', cursor);
      stoppedByQuota = true;
      throw err;
    }
    throw err;
  }
}

async function importCompetitionSeason(
  repo: StatPalRepository,
  league: StatPalLeagueConfig,
  season: string
): Promise<void> {
  const allDone = STATPAL_PHASES.every(
    (phase) => repo.getFetchState(league.code, season, phase)?.status === 'done'
  );
  if (allDone) {
    console.log(`\n[skip] ${league.code} ${season} — all phases done`);
    return;
  }

  console.log(`\n========== ${league.label} (${league.code}) season ${season} ==========`);
  const seasonStats = emptyImportStats();
  const before = { ...globalStats };

  const ctx = await loadSeasonContext(repo, league, season);
  console.log(`  Loaded ${ctx.allMatches.length} match(es) from /matches`);

  for (const phase of STATPAL_PHASES) {
    if (stoppedByQuota) break;
    await runPhase(phase, ctx, repo);
  }

  const delta = {
    teams: globalStats.teams - before.teams,
    players: globalStats.players - before.players,
    transfers: globalStats.transfers - before.transfers,
    trophies: globalStats.trophies - before.trophies,
    matches: globalStats.matches - before.matches,
    lineups: globalStats.lineups - before.lineups,
    teammatePairs: globalStats.teammatePairs - before.teammatePairs,
  };
  Object.assign(seasonStats, delta);
  await refreshQuota();
  logSummary(`${league.code} ${season}`, seasonStats);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  runMigrations();
  const db = getDb();
  const repo = new StatPalRepository(db);

  await refreshQuota();

  const concurrency = getStatPalConcurrency();
  console.log(`StatPal import — concurrency=${concurrency}, dailyStop=${STATPAL_DAILY_STOP}`);

  const leagues = args.competition
    ? [getLeagueByCode(args.competition)].filter(Boolean) as StatPalLeagueConfig[]
    : STATPAL_LEAGUES;

  if (leagues.length === 0) {
    console.error('Unknown --competition');
    process.exit(1);
  }

  const seasons = args.season ? [args.season] : [...STATPAL_TARGET_SEASONS];

  try {
    for (const league of leagues) {
      for (const season of seasons) {
        if (stoppedByQuota) break;
        await importCompetitionSeason(repo, league, season);
      }
    }
  } catch (err) {
    if (err instanceof StatPalQuotaError) {
      console.log('\n[quota] Daily limit reached — state saved, resume tomorrow.');
    } else {
      throw err;
    }
  }

  await refreshQuota();
  logSummary('TOTAL', globalStats);
  closeDb();
  process.exit(stoppedByQuota ? 0 : 0);
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
