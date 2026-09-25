import { getTodayDateString } from './daily-hash';

export { isFuturePuzzleDate, clampPlayablePuzzleDate } from './daily-hash';

export type DailyGameId =
  | 'daily-player'
  | 'higher-lower'
  | 'missing-xi'
  | 'career-path'
  | 'club-grid'
  | 'onluk'
  | 'connections';

export interface OfficialPlayRecord {
  played: true;
  status: 'won' | 'lost';
  completedAt: string;
}

function storageKey(gameId: DailyGameId, date: string): string {
  return `football-daily-official:v1:${gameId}:${date}`;
}

export function isArchiveDate(date: string): boolean {
  return date < getTodayDateString();
}

export function isToday(date: string): boolean {
  return date === getTodayDateString();
}

export function getOfficialPlayRecord(
  gameId: DailyGameId,
  date: string
): OfficialPlayRecord | null {
  if (typeof window === 'undefined' || !isToday(date)) return null;
  try {
    const raw = localStorage.getItem(storageKey(gameId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfficialPlayRecord;
    return parsed?.played ? parsed : null;
  } catch {
    return null;
  }
}

export function hasOfficialPlayToday(gameId: DailyGameId, date: string): boolean {
  return isToday(date) && getOfficialPlayRecord(gameId, date) !== null;
}

export function markOfficialPlayed(
  gameId: DailyGameId,
  date: string,
  status: 'won' | 'lost'
): void {
  if (typeof window === 'undefined' || !isToday(date)) return;
  const record: OfficialPlayRecord = {
    played: true,
    status,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem(storageKey(gameId, date), JSON.stringify(record));
}

export function shouldPersistGameState(date: string): boolean {
  return isToday(date);
}

export function isGameStartBlocked(gameId: DailyGameId, date: string): boolean {
  return isToday(date) && hasOfficialPlayToday(gameId, date);
}

export function listArchiveDates(days = 30): string[] {
  const today = getTodayDateString();
  const out: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(`${today}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
