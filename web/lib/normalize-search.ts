/**
 * Accent / special-letter fold for player search.
 * "Ødegaard" → "odegaard", "Jurriën" → "jurrien", "Łukasz" → "lukasz".
 */
const SPECIAL_LETTER_MAP: Record<string, string> = {
  ø: 'o',
  Ø: 'o',
  œ: 'oe',
  Œ: 'oe',
  æ: 'ae',
  Æ: 'ae',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ħ: 'h',
  Ħ: 'h',
  ı: 'i',
  İ: 'i',
  ß: 'ss',
  ẞ: 'ss',
  ǿ: 'o',
  Ǿ: 'o',
};

export function normalizeForSearch(value: string): string {
  let out = '';
  for (const ch of value) {
    out += SPECIAL_LETTER_MAP[ch] ?? ch;
  }
  return out
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
