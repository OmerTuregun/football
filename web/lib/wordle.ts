/** Shared Wordle-style letter evaluation (duplicate-aware). */

export type TileStatus = 'correct' | 'present' | 'absent';

/**
 * Fold lookalike / accented letters so guesses work across keyboards.
 * Ødegaard → ODEGAARD, İlkay → ILKAY, Müller → MULLER, etc.
 */
export function normalizeAnswerLetters(name: string): string {
  return name
    .normalize('NFC')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    // Nordic / special Latin that often don't strip via NFD
    .replace(/[ØǾ]/g, 'O')
    .replace(/[ÅÅ]/g, 'A')
    .replace(/Æ/g, 'A')
    .replace(/[ĐÐ]/g, 'D')
    .replace(/Ł/g, 'L')
    .replace(/Þ/g, 'T')
    .replace(/Œ/g, 'O')
    .replace(/ẞ/g, 'S')
    // Strip accents: É→E, Ó→O, Ç→C, Ö→O, Ü→U, Ğ→G, Ş→S, Č→C, …
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Z]/g, '');
}

/** Split display name into word letter-counts, e.g. "Erling Haaland" → [6, 7]. */
export function wordLetterCounts(name: string): number[] {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => normalizeAnswerLetters(w).length)
    .filter((n) => n > 0);
}

export function evaluateWordle(guessRaw: string, answerRaw: string): TileStatus[] {
  const guess = normalizeAnswerLetters(guessRaw);
  const answer = normalizeAnswerLetters(answerRaw);

  if (guess.length !== answer.length) {
    throw new Error('Guess length mismatch');
  }

  const result: TileStatus[] = Array(guess.length).fill('absent');
  const remaining: Record<string, number> = {};

  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1;
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue;
    const ch = guess[i];
    if ((remaining[ch] ?? 0) > 0) {
      result[i] = 'present';
      remaining[ch] -= 1;
    }
  }

  return result;
}
