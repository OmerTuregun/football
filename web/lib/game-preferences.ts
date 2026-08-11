import type { DailyGameId } from './daily-access';

const PREFS_KEY = 'football-prefs:v1';

interface GamePreferences {
  timerEnabled: boolean;
}

const DEFAULT_TIMER_SECONDS: Record<DailyGameId, number> = {
  'daily-player': 5 * 60,
  'higher-lower': 3 * 60,
  'missing-xi': 8 * 60,
  'career-path': 6 * 60,
  'club-grid': 5 * 60,
  onluk: 4 * 60,
  connections: 8 * 60,
};

export function getDefaultTimerSeconds(gameId: DailyGameId): number {
  return DEFAULT_TIMER_SECONDS[gameId];
}

export function getTimerEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as GamePreferences;
    return !!parsed.timerEnabled;
  } catch {
    return false;
  }
}

export function setTimerEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const current: GamePreferences = { timerEnabled: enabled };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) Object.assign(current, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  current.timerEnabled = enabled;
  localStorage.setItem(PREFS_KEY, JSON.stringify(current));
}

export { DEFAULT_TIMER_SECONDS as GAME_TIMER_DEFAULTS };
