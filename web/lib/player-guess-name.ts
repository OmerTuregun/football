/**
 * Extract the name players should guess: surname / mononym.
 * "Marc-André ter Stegen" → "ter Stegen"
 * "Raphinha" → "Raphinha"
 * "Erling Haaland" → "Haaland"
 * "Virgil van Dijk" → "van Dijk"
 * "Vinicius Junior" → "Vinicius Junior"
 */

const SURNAME_PARTICLES = new Set([
  'van',
  'von',
  'de',
  'da',
  'di',
  'del',
  'della',
  'der',
  'den',
  'ter',
  'ten',
  'te',
  'la',
  'le',
  'el',
  'dos',
  'das',
  'do',
  'af',
  'av',
  'ben',
  'bin',
  'ibn',
  'al',
  'ul',
  'vom',
  'zur',
  'zu',
  'y',
  'st',
  'saint',
  'san',
  'santa',
  'mc',
  'mac',
]);

function normalizeToken(token: string): string {
  return token
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/\./g, '');
}

function isParticle(token: string): boolean {
  return SURNAME_PARTICLES.has(normalizeToken(token));
}

function isJuniorSuffix(token: string): boolean {
  const t = normalizeToken(token);
  return t === 'junior' || t === 'júnior' || t === 'jr';
}

export function extractGuessName(fullName: string): string {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;

  const parts = trimmed.split(' ');
  if (parts.length === 1) return parts[0];

  // Keep known double mononyms like "Vinicius Junior"
  if (isJuniorSuffix(parts[parts.length - 1])) {
    return parts.slice(-2).join(' ');
  }

  let start = parts.length - 1;
  while (start > 0 && isParticle(parts[start - 1])) {
    start -= 1;
  }

  return parts.slice(start).join(' ');
}
