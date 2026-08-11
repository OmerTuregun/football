export function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
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
