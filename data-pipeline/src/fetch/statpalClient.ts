import { getStatPalAccessKey, getStatPalConcurrency } from '../config';
import { sleep } from '../utils';

const SOCCER_BASE = 'https://statpal.io/api/v2/soccer';
const USAGE_BASE = 'https://statpal.io/api';

export const STATPAL_DAILY_LIMIT = 50_000;
export const STATPAL_DAILY_STOP = 48_000;
export const STATPAL_USAGE_CHECK_INTERVAL = 100;
export const STATPAL_MAX_RETRIES = 3;

export { getStatPalConcurrency };

export class StatPalQuotaError extends Error {
  constructor(
    message: string,
    public readonly requestCount: number
  ) {
    super(message);
    this.name = 'StatPalQuotaError';
  }
}

export class StatPalTransientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'StatPalTransientError';
  }
}

export interface UserRequestCount {
  access_key: string;
  current_date: string;
  request_count: number;
}

let apiCallsThisSession = 0;
let lastKnownRequestCount: number | null = null;
let callsSinceUsageCheck = 0;

export function getApiCallsThisSession(): number {
  return apiCallsThisSession;
}

export function getLastKnownRequestCount(): number | null {
  return lastKnownRequestCount;
}

export async function getUserRequestCount(): Promise<UserRequestCount> {
  const url = `${USAGE_BASE}/user-request-count?access_key=${encodeURIComponent(getStatPalAccessKey())}`;
  const res = await fetch(url);
  const text = await res.text();
  let json: UserRequestCount;
  try {
    json = JSON.parse(text) as UserRequestCount;
  } catch {
    throw new StatPalTransientError(
      `StatPal usage check non-JSON HTTP ${res.status}: ${text.slice(0, 120)}`,
      res.status
    );
  }
  if (!res.ok) {
    throw new Error(`StatPal usage check failed: ${JSON.stringify(json)}`);
  }
  lastKnownRequestCount = json.request_count;
  return json;
}

async function maybeCheckQuota(): Promise<void> {
  callsSinceUsageCheck += 1;
  if (callsSinceUsageCheck < STATPAL_USAGE_CHECK_INTERVAL) return;
  callsSinceUsageCheck = 0;
  try {
    const usage = await getUserRequestCount();
    console.log(
      `[statpal quota] ${usage.current_date}: ${usage.request_count}/${STATPAL_DAILY_LIMIT} requests today (concurrency=${getStatPalConcurrency()})`
    );
    if (usage.request_count >= STATPAL_DAILY_STOP) {
      throw new StatPalQuotaError(
        `Daily quota nearly exhausted (${usage.request_count}/${STATPAL_DAILY_LIMIT})`,
        usage.request_count
      );
    }
  } catch (err) {
    if (err instanceof StatPalQuotaError) throw err;
    // VPN / gateway blips must not kill the import mid-batch
    console.warn(
      `  [quota] check skipped:`,
      err instanceof Error ? err.message.slice(0, 120) : err
    );
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function statpalFetch<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  countsTowardQuota = true
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= STATPAL_MAX_RETRIES; attempt += 1) {
    const qs = new URLSearchParams({ access_key: getStatPalAccessKey() });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const url = `${SOCCER_BASE}${path}?${qs}`;

    if (countsTowardQuota) {
      await maybeCheckQuota();
    }

    const res = await fetch(url);
    const text = await res.text();

    if (countsTowardQuota) {
      apiCallsThisSession += 1;
    }

    if (isRetryableStatus(res.status)) {
      lastError = new StatPalTransientError(
        `StatPal ${path} HTTP ${res.status}: ${text.slice(0, 120)}`,
        res.status
      );
      if (attempt < STATPAL_MAX_RETRIES) {
        const delayMs = 1000 * 2 ** attempt;
        console.warn(`  [retry] ${path} HTTP ${res.status}, wait ${delayMs}ms (${attempt + 1}/${STATPAL_MAX_RETRIES})`);
        await sleep(delayMs);
        continue;
      }
      throw lastError;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`StatPal non-JSON ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const err = json as { error?: string; code?: number };
      throw new Error(`StatPal ${path} HTTP ${res.status}: ${err.error ?? text.slice(0, 200)}`);
    }

    return json as T;
  }

  throw lastError ?? new Error(`StatPal ${path} failed after retries`);
}

export async function getLeagues(): Promise<unknown> {
  return statpalFetch('/leagues');
}

export async function getSeasons(): Promise<unknown> {
  return statpalFetch('/leagues/seasons');
}

export async function getStandings(leagueId: string, season: string): Promise<unknown> {
  return statpalFetch(`/leagues/${leagueId}/standings`, { season });
}

export async function getLeagueMatches(leagueId: string, season: string): Promise<unknown> {
  return statpalFetch(`/leagues/${leagueId}/matches`, { season });
}

export async function getLeagueMatchesStatsByDate(
  leagueId: string,
  date: string
): Promise<unknown> {
  return statpalFetch(`/leagues/${leagueId}/matches/stats`, { date });
}

export async function getTeam(teamId: string): Promise<unknown> {
  return statpalFetch(`/teams/${teamId}`);
}

export async function getPlayer(playerId: string): Promise<unknown> {
  return statpalFetch(`/players/${playerId}`);
}
