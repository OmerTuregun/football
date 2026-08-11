import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// config.ts lives in src/ — project root is one level up
export const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
dotenv.config({ path: path.join(PROJECT_ROOT, '..', '.env') });

export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const RAW_CACHE_DIR = path.join(PROJECT_ROOT, 'src', 'raw-cache');
export const DB_PATH = path.join(DATA_DIR, 'football.db');

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, RAW_CACHE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getApiKey(): string {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key || key === 'your_api_key_here') {
    throw new Error(
      'FOOTBALL_DATA_API_KEY is not set. Copy .env.example to .env and add your key.'
    );
  }
  return key;
}

export function getApiFootballKey(): string {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key || key === 'your_api_football_key_here') {
    throw new Error(
      'API_FOOTBALL_KEY is not set. Add your key from dashboard.api-football.com to .env.'
    );
  }
  return key;
}

export function getStatPalAccessKey(): string {
  const key = process.env.STATPAL_ACCESS_KEY;
  if (!key || key === 'your_statpal_access_key_here') {
    throw new Error(
      'STATPAL_ACCESS_KEY is not set. Add your StatPal trial key to root .env.'
    );
  }
  return key;
}

export function getStatPalConcurrency(): number {
  const raw = process.env.STATPAL_CONCURRENCY;
  const n = raw ? parseInt(raw, 10) : 6;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 6;
}
