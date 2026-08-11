import 'server-only';

/** Shared club name canonicalization for Missing XI / Club Grid. */

export interface CanonicalClubDef {
  key: string;
  label: string;
  needles: string[];
  /** Prefer football-data crest lookup with these name fragments */
  crestNeedles?: string[];
  tier: 'elite' | 'known';
}

export const CANONICAL_CLUBS: CanonicalClubDef[] = [
  { key: 'real-madrid', label: 'Real Madrid', needles: ['real madrid'], tier: 'elite' },
  { key: 'barcelona', label: 'Barcelona', needles: ['barcelona'], tier: 'elite' },
  {
    key: 'atletico',
    label: 'Atlético Madrid',
    needles: ['atletico madrid', 'atlético madrid', 'club atlético'],
    crestNeedles: ['atlético de madrid', 'atletico de madrid'],
    tier: 'elite',
  },
  { key: 'bayern', label: 'Bayern München', needles: ['bayern'], tier: 'elite' },
  { key: 'dortmund', label: 'Borussia Dortmund', needles: ['dortmund'], tier: 'elite' },
  { key: 'man-city', label: 'Manchester City', needles: ['manchester city'], tier: 'elite' },
  { key: 'man-utd', label: 'Manchester United', needles: ['manchester united'], tier: 'elite' },
  { key: 'liverpool', label: 'Liverpool', needles: ['liverpool'], tier: 'elite' },
  { key: 'arsenal', label: 'Arsenal', needles: ['arsenal'], tier: 'elite' },
  { key: 'chelsea', label: 'Chelsea', needles: ['chelsea'], tier: 'elite' },
  { key: 'tottenham', label: 'Tottenham', needles: ['tottenham'], tier: 'elite' },
  { key: 'juventus', label: 'Juventus', needles: ['juventus'], tier: 'elite' },
  { key: 'inter', label: 'Inter', needles: ['internazionale'], tier: 'elite' },
  { key: 'milan', label: 'AC Milan', needles: ['ac milan'], tier: 'elite' },
  { key: 'napoli', label: 'Napoli', needles: ['napoli'], tier: 'elite' },
  {
    key: 'psg',
    label: 'Paris Saint-Germain',
    needles: ['paris s.g', 'paris saint', 'psg'],
    crestNeedles: ['paris saint-germain'],
    tier: 'elite',
  },
  { key: 'leipzig', label: 'RB Leipzig', needles: ['leipzig'], tier: 'known' },
  { key: 'leverkusen', label: 'Bayer Leverkusen', needles: ['leverkusen'], tier: 'known' },
  { key: 'benfica', label: 'Benfica', needles: ['benfica'], tier: 'known' },
  { key: 'porto', label: 'FC Porto', needles: ['porto'], tier: 'known' },
  { key: 'ajax', label: 'Ajax', needles: ['ajax'], tier: 'known' },
  { key: 'roma', label: 'AS Roma', needles: ['roma'], tier: 'known' },
  { key: 'lazio', label: 'Lazio', needles: ['lazio'], tier: 'known' },
  { key: 'atalanta', label: 'Atalanta', needles: ['atalanta'], tier: 'known' },
  { key: 'sevilla', label: 'Sevilla', needles: ['sevilla'], tier: 'known' },
  { key: 'galatasaray', label: 'Galatasaray', needles: ['galatasaray'], tier: 'known' },
  {
    key: 'fenerbahce',
    label: 'Fenerbahçe',
    needles: ['fenerbahce', 'fenerbahçe'],
    tier: 'known',
  },
  {
    key: 'besiktas',
    label: 'Beşiktaş',
    needles: ['besiktas', 'beşiktaş'],
    tier: 'known',
  },
  { key: 'newcastle', label: 'Newcastle', needles: ['newcastle'], tier: 'known' },
  { key: 'west-ham', label: 'West Ham', needles: ['west ham'], tier: 'known' },
  { key: 'aston-villa', label: 'Aston Villa', needles: ['aston villa'], tier: 'known' },
  { key: 'monaco', label: 'Monaco', needles: ['monaco'], tier: 'known' },
  { key: 'marseille', label: 'Marseille', needles: ['marseille'], tier: 'known' },
  { key: 'lyon', label: 'Lyon', needles: ['lyon'], tier: 'known' },
  { key: 'villarreal', label: 'Villarreal', needles: ['villarreal'], tier: 'known' },
  { key: 'real-sociedad', label: 'Real Sociedad', needles: ['real sociedad'], tier: 'known' },
];

const BY_KEY = new Map(CANONICAL_CLUBS.map((c) => [c.key, c]));

export function normalizeTeamKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('tr-TR');
}

function isFalseFriend(key: string): boolean {
  return (
    key.includes('tula') ||
    key.includes('tivat') ||
    key.includes('paris fc') ||
    key.includes('u18') ||
    key.includes('u19') ||
    key.includes('u21') ||
    key.includes('espanyol') ||
    key.includes('airport') ||
    key.endsWith(' ii') ||
    /\b(reserves|youth|women)\b/.test(key)
  );
}

export function canonicalClubKey(name: string): string | null {
  if (!name?.trim()) return null;
  const key = normalizeTeamKey(name);
  if (isFalseFriend(key)) return null;

  for (const club of CANONICAL_CLUBS) {
    if (!club.needles.some((n) => key.includes(n))) continue;

    if (club.key === 'arsenal' && (key.includes('tula') || key.includes('tivat'))) return null;
    if (club.key === 'psg' && key.includes('paris fc')) return null;
    if (club.key === 'milan' && key.includes('inter')) return null;
    if (club.key === 'inter' && (key === 'milan' || key.includes('ac milan'))) return null;
    if (club.key === 'porto' && !key.includes('porto')) return null;
    if (club.key === 'roma' && (key.includes('as roma') || key === 'roma' || key.endsWith(' roma'))) {
      // ok
    } else if (club.key === 'roma' && key.includes('roma') && key.includes('lazio')) {
      return null;
    }

    return club.key;
  }

  if (key === 'inter' || key.startsWith('inter ')) return 'inter';
  if (key === 'milan' || (/\bmilan\b/.test(key) && !key.includes('inter'))) return 'milan';

  return null;
}

export function getCanonicalClub(key: string): CanonicalClubDef | undefined {
  return BY_KEY.get(key);
}

export function eliteClubKeys(): string[] {
  return CANONICAL_CLUBS.filter((c) => c.tier === 'elite').map((c) => c.key);
}

export function knownClubKeys(): string[] {
  return CANONICAL_CLUBS.map((c) => c.key);
}
