import { getApiFootballKey } from '../config';

// Direct API-Football (dashboard.api-football.com), not RapidAPI
const BASE_URL = 'https://v3.football.api-sports.io';
const RATE_LIMIT_STOP_THRESHOLD = 5;

export class RateLimitExceededError extends Error {
  constructor(public readonly remaining: number) {
    super('Daily API-Football rate limit nearly exhausted');
    this.name = 'RateLimitExceededError';
  }
}

export interface ApiFootballPaging {
  current: number;
  total: number;
}

export interface ApiFootballLeague {
  league: {
    id: number;
    name: string;
    type: string;
    logo: string;
  };
  country: {
    name: string;
    code: string | null;
    flag: string | null;
  };
  seasons: Array<{
    year: number;
    start: string;
    end: string;
    current: boolean;
  }>;
}

export interface ApiFootballTeam {
  team: {
    id: number;
    name: string;
    code: string | null;
    country: string | null;
    founded: number | null;
    logo: string | null;
  };
  venue: {
    id: number | null;
    name: string | null;
    city: string | null;
  };
}

export interface ApiFootballPlayerEntry {
  player: {
    id: number;
    name: string;
    firstname: string | null;
    lastname: string | null;
    age: number | null;
    nationality: string | null;
  };
  statistics: Array<{
    team: {
      id: number;
      name: string;
      logo: string | null;
    };
    league: {
      id: number;
      name: string;
      country: string;
      season: number;
    };
    games: {
      appearences: number | null;
      minutes: number | null;
    };
    goals: {
      total: number | null;
      assists: number | null;
    };
  }>;
}

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string | number>;
  errors: unknown[];
  results: number;
  paging: ApiFootballPaging;
  response: T;
}

let requestsRemaining: number | null = null;
let requestsUsedThisSession = 0;

export function getRequestsUsedThisSession(): number {
  return requestsUsedThisSession;
}

export function getRequestsRemaining(): number | null {
  return requestsRemaining;
}

function readRateLimitHeader(response: Response): void {
  const remaining = response.headers.get('x-ratelimit-requests-remaining');
  if (remaining !== null) {
    requestsRemaining = parseInt(remaining, 10);
    console.log(`[rate-limit] x-ratelimit-requests-remaining: ${requestsRemaining}`);
    if (requestsRemaining < RATE_LIMIT_STOP_THRESHOLD) {
      throw new RateLimitExceededError(requestsRemaining);
    }
  }
}

async function apiFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<ApiFootballResponse<T>> {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = query ? `${BASE_URL}/${path}?${query}` : `${BASE_URL}/${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'x-apisports-key': getApiFootballKey(),
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? (err as Error & { cause?: Error }).cause : undefined;
    const detail = cause?.message ?? (err instanceof Error ? err.message : String(err));
    throw new Error(
      `Cannot reach ${BASE_URL} (${detail}). ` +
        'Direct API-Football uses v3.football.api-sports.io — if TLS fails, a corporate firewall/proxy is likely blocking it. ' +
        'Try VPN/home network, or ask IT to allowlist that host.'
    );
  }

  requestsUsedThisSession += 1;
  readRateLimitHeader(response);

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`API-Football HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = JSON.parse(body) as ApiFootballResponse<T>;
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

/** Fetch all leagues (run once manually to verify league ID mapping). */
export async function getLeagues(): Promise<ApiFootballLeague[]> {
  const data = await apiFetch<ApiFootballLeague[]>('leagues');
  return data.response;
}

/** Teams participating in a league season (for name → API team ID matching). */
export async function getTeamsByLeagueAndSeason(
  leagueId: number,
  season: number
): Promise<ApiFootballTeam[]> {
  const data = await apiFetch<ApiFootballTeam[]>('teams', { league: leagueId, season });
  return data.response;
}

/** All players for a team in a season, with pagination. */
export async function getPlayersByTeamAndSeason(
  apiFootballTeamId: number,
  season: number,
  startPage = 1
): Promise<{ players: ApiFootballPlayerEntry[]; lastPageFetched: number; completed: boolean }> {
  const allPlayers: ApiFootballPlayerEntry[] = [];
  let page = startPage;
  let totalPages = 1;

  while (page <= totalPages) {
    const data = await apiFetch<ApiFootballPlayerEntry[]>('players', {
      team: apiFootballTeamId,
      season,
      page,
    });

    allPlayers.push(...data.response);
    totalPages = data.paging.total;
    const currentPage = page;
    page += 1;

    if (currentPage >= totalPages) {
      return { players: allPlayers, lastPageFetched: currentPage, completed: true };
    }
  }

  return { players: allPlayers, lastPageFetched: page - 1, completed: true };
}
