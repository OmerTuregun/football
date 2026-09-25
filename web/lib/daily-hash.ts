const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isValidCalendarDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === date;
}

export function isFuturePuzzleDate(date: string): boolean {
  return date > getTodayDateString();
}

/** Today and past dates only — future days unlock as the calendar advances. */
export function clampPlayablePuzzleDate(date: string): string {
  const today = getTodayDateString();
  if (!isValidCalendarDate(date) || date > today) return today;
  return date;
}

export function resolvePlayablePuzzleDate(
  raw: string | null | undefined
): { date: string } | { error: string } {
  const today = getTodayDateString();
  if (!raw) return { date: today };
  if (!isValidCalendarDate(raw)) return { error: 'Invalid date' };
  if (raw > today) return { error: 'Bu günün oyunu henüz açılmadı' };
  return { date: raw };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getDailyIndex(
  date: string,
  puzzleKey: string,
  poolSize: number
): number {
  if (poolSize <= 0) return 0;
  return hashString(`${date}:${puzzleKey}`) % poolSize;
}

export function buildPuzzleKey(
  modeId: string,
  difficulty: string,
  session: number
): string {
  return `${modeId}:${difficulty}:${session}`;
}
