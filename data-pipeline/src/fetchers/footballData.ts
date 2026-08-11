import fs from 'fs';
import path from 'path';
import { getDb } from '../db/client';
import { getApiKey, RAW_CACHE_DIR, ensureDirs } from '../config';
import { hashParams, sleep } from '../utils';

const BASE_URL = 'https://api.football-data.org/v4';
const RATE_LIMIT_MS = 6500;
const MAX_RETRIES = 3;

let lastRequestAt = 0;

export interface FetchResult<T = unknown> {
  success: boolean;
  data?: T;
  cacheFile?: string;
  httpStatus?: number;
  error?: string;
  endpoint: string;
  paramsHash: string;
}

function buildCacheFileName(endpoint: string, paramsHash: string): string {
  const safeEndpoint = endpoint.replace(/\//g, '_').replace(/^_/, '');
  return `footballData_${safeEndpoint}_${paramsHash}.json`;
}

function logFetch(
  endpoint: string,
  paramsHash: string,
  cacheFile: string | null,
  httpStatus: number | null,
  success: boolean,
  errorMessage: string | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO fetch_log (endpoint, params_hash, cache_file, http_status, success, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(endpoint, paramsHash, cacheFile, httpStatus, success ? 1 : 0, errorMessage);
}

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
}

function logRateLimitHeaders(response: Response, url: string): void {
  const xHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-')) {
      xHeaders[key] = value;
    }
  });
  if (Object.keys(xHeaders).length === 0) return;
  console.log(`[rate-limit] ${url}`);
  for (const [key, value] of Object.entries(xHeaders)) {
    console.log(`  ${key}: ${value}`);
  }
}

async function fetchWithRetry(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  let lastError = 'Unknown error';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await waitForRateLimit();

    try {
      const response = await fetch(url, {
        headers: {
          'X-Auth-Token': getApiKey(),
          Accept: 'application/json',
        },
      });
      lastRequestAt = Date.now();
      const body = await response.text();

      if (response.ok) {
        logRateLimitHeaders(response, url);
        return { ok: true, status: response.status, body };
      }

      lastError = `HTTP ${response.status}: ${body.slice(0, 300)}`;
      if (response.status === 429 || response.status >= 500) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.warn(`[retry ${attempt + 1}/${MAX_RETRIES}] ${lastError} — waiting ${backoff}ms`);
        await sleep(backoff);
        continue;
      }

      return { ok: false, status: response.status, body };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`[retry ${attempt + 1}/${MAX_RETRIES}] ${lastError} — waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }

  throw new Error(lastError);
}

async function fetchAndCache<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<FetchResult<T>> {
  ensureDirs();
  const paramsHash = hashParams(params);
  const cacheFileName = buildCacheFileName(endpoint, paramsHash);
  const cachePath = path.join(RAW_CACHE_DIR, cacheFileName);

  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = query ? `${BASE_URL}/${endpoint}?${query}` : `${BASE_URL}/${endpoint}`;

  try {
    const { ok, status, body } = await fetchWithRetry(url);

    if (!ok) {
      const error = `HTTP ${status}: ${body.slice(0, 300)}`;
      logFetch(endpoint, paramsHash, null, status, false, error);
      if (status === 403) {
        console.warn(`[fetch restricted] ${endpoint}: not included in current API subscription`);
      } else {
        console.error(`[fetch failed] ${endpoint}: ${error}`);
      }
      return { success: false, error, httpStatus: status, endpoint, paramsHash };
    }

    fs.writeFileSync(cachePath, body, 'utf-8');
    logFetch(endpoint, paramsHash, cacheFileName, status, true, null);

    const data = JSON.parse(body) as T;
    return { success: true, data, cacheFile: cacheFileName, httpStatus: status, endpoint, paramsHash };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logFetch(endpoint, paramsHash, null, null, false, error);
    console.error(`[fetch failed] ${endpoint}: ${error}`);
    return { success: false, error, endpoint, paramsHash };
  }
}

export function readCache<T>(cacheFile: string): T {
  const cachePath = path.join(RAW_CACHE_DIR, cacheFile);
  const raw = fs.readFileSync(cachePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function findLatestCacheFile(pattern: string): string | null {
  if (!fs.existsSync(RAW_CACHE_DIR)) return null;
  const files = fs
    .readdirSync(RAW_CACHE_DIR)
    .filter((f) => f.startsWith(`footballData_${pattern}`) && f.endsWith('.json'))
    .sort()
    .reverse();
  return files[0] ?? null;
}

export async function fetchCompetition(code: string): Promise<FetchResult> {
  return fetchAndCache(`competitions/${code}`);
}

export async function fetchCompetitionTeams(
  code: string,
  season?: number
): Promise<FetchResult> {
  return fetchAndCache(`competitions/${code}/teams`, season ? { season } : {});
}

export async function fetchCompetitionMatches(
  code: string,
  season: number
): Promise<FetchResult> {
  return fetchAndCache(`competitions/${code}/matches`, { season });
}

export async function fetchCompetitionStandings(
  code: string,
  season: number
): Promise<FetchResult> {
  return fetchAndCache(`competitions/${code}/standings`, { season });
}

/** Single match detail (goals[], penalties[], score breakdown). */
export async function fetchMatchDetail(matchId: number): Promise<FetchResult> {
  return fetchAndCache(`matches/${matchId}`);
}
