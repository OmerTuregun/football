const CREST_BASE = 'https://crests.football-data.org';

/** StatPal-created competitions often ship without emblem URLs in SQLite. */
export const LEAGUE_EMBLEM_BY_CODE: Record<string, string> = {
  SL: `${CREST_BASE}/524.png`,
  PPL: `${CREST_BASE}/PPL.png`,
  DED: `${CREST_BASE}/ED.png`,
  EL: `${CREST_BASE}/EL.png`,
  ECL: `${CREST_BASE}/2004.png`,
  CL: `${CREST_BASE}/CL.png`,
  PL: `${CREST_BASE}/PL.png`,
  PD: `${CREST_BASE}/laliga.png`,
  BL1: `${CREST_BASE}/BL1.png`,
  SA: `${CREST_BASE}/c111.png`,
  FL1: `${CREST_BASE}/FL1.png`,
};

/**
 * football-data.org crest IDs for common club names (esp. StatPal short names
 * that land in DB with crest = null).
 */
export const TEAM_CREST_BY_ALIAS: Record<string, string> = {
  barcelona: `${CREST_BASE}/81.png`,
  'fc barcelona': `${CREST_BASE}/81.png`,
  barca: `${CREST_BASE}/81.png`,
  girona: `${CREST_BASE}/298.png`,
  'girona fc': `${CREST_BASE}/298.png`,
  'manchester united': `${CREST_BASE}/66.png`,
  'manchester united fc': `${CREST_BASE}/66.png`,
  'manchester utd': `${CREST_BASE}/66.png`,
  'man utd': `${CREST_BASE}/66.png`,
  'manchester city': `${CREST_BASE}/65.png`,
  'manchester city fc': `${CREST_BASE}/65.png`,
  'real madrid': `${CREST_BASE}/86.png`,
  'real madrid cf': `${CREST_BASE}/86.png`,
  arsenal: `${CREST_BASE}/57.png`,
  'arsenal fc': `${CREST_BASE}/57.png`,
  chelsea: `${CREST_BASE}/61.png`,
  'chelsea fc': `${CREST_BASE}/61.png`,
  liverpool: `${CREST_BASE}/64.png`,
  'liverpool fc': `${CREST_BASE}/64.png`,
  tottenham: `${CREST_BASE}/73.png`,
  'tottenham hotspur': `${CREST_BASE}/73.png`,
  'tottenham hotspur fc': `${CREST_BASE}/73.png`,
  fenerbahce: `${CREST_BASE}/611.png`,
  'fenerbahçe': `${CREST_BASE}/611.png`,
  galatasaray: `${CREST_BASE}/610.png`,
  'beşiktaş': `${CREST_BASE}/612.png`,
  besiktas: `${CREST_BASE}/612.png`,
  juventus: `${CREST_BASE}/109.png`,
  'ac milan': `${CREST_BASE}/98.png`,
  inter: `${CREST_BASE}/108.png`,
  internazionale: `${CREST_BASE}/108.png`,
  'inter milan': `${CREST_BASE}/108.png`,
  napoli: `${CREST_BASE}/113.png`,
  'ssc napoli': `${CREST_BASE}/113.png`,
  'bayern munich': `${CREST_BASE}/5.png`,
  'bayern münchen': `${CREST_BASE}/5.png`,
  'fc bayern münchen': `${CREST_BASE}/5.png`,
  'borussia dortmund': `${CREST_BASE}/4.png`,
  dortmund: `${CREST_BASE}/4.png`,
  'paris saint-germain': `${CREST_BASE}/524.png`,
  'paris saint germain': `${CREST_BASE}/524.png`,
  psg: `${CREST_BASE}/524.png`,
  'atlético madrid': `${CREST_BASE}/78.png`,
  'atletico madrid': `${CREST_BASE}/78.png`,
  'club atlético de madrid': `${CREST_BASE}/78.png`,
};

/** Nationalities that do not slug cleanly on football-data.org. */
export const NATIONALITY_FLAG_OVERRIDES: Record<string, string> = {
  "côte d'ivoire": `${CREST_BASE}/788.svg`,
  "cote d'ivoire": `${CREST_BASE}/788.svg`,
  'ivory coast': `${CREST_BASE}/788.svg`,
  'united states': `${CREST_BASE}/usa.svg`,
  usa: `${CREST_BASE}/usa.svg`,
  'south korea': `${CREST_BASE}/776.svg`,
  'korea republic': `${CREST_BASE}/776.svg`,
  'bosnia-herzegovina': `${CREST_BASE}/bosnia.svg`,
  'bosnia and herzegovina': `${CREST_BASE}/bosnia.svg`,
  'dr congo': `${CREST_BASE}/805.svg`,
  'democratic republic of the congo': `${CREST_BASE}/805.svg`,
  'republic of the congo': `${CREST_BASE}/806.svg`,
  congo: `${CREST_BASE}/806.svg`,
  'faroe islands': `${CREST_BASE}/816.svg`,
  'faeroe islands': `${CREST_BASE}/816.svg`,
  'cape verde': `${CREST_BASE}/831.svg`,
  'cape verde islands': `${CREST_BASE}/831.svg`,
  nigeria: `${CREST_BASE}/nigeria.svg`,
};

function normKey(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

export function slugifyNationality(nationality: string): string {
  return nationality
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function fallbackNationalityFlagUrl(nationality: string): string | null {
  const key = normKey(nationality);
  if (!key || key === 'bilinmiyor') return null;
  if (NATIONALITY_FLAG_OVERRIDES[key]) return NATIONALITY_FLAG_OVERRIDES[key];
  const slug = slugifyNationality(nationality);
  if (!slug) return null;
  return `${CREST_BASE}/${slug}.svg`;
}

export function fallbackLeagueEmblemUrl(code: string | null | undefined): string | null {
  if (!code) return null;
  return LEAGUE_EMBLEM_BY_CODE[code.trim().toUpperCase()] ?? null;
}

export function resolveLeagueEmblem(
  code: string | null | undefined,
  emblem: string | null | undefined
): string | null {
  const trimmed = emblem?.trim();
  if (trimmed) return trimmed;
  return fallbackLeagueEmblemUrl(code);
}

export function resolveNationalityFlag(
  nationality: string,
  fromDb: string | null | undefined
): string | null {
  const trimmed = fromDb?.trim();
  if (trimmed) return trimmed;
  return fallbackNationalityFlagUrl(nationality);
}

export function fallbackTeamCrestUrl(teamName: string | null | undefined): string | null {
  if (!teamName?.trim()) return null;
  const key = normKey(teamName);
  if (TEAM_CREST_BY_ALIAS[key]) return TEAM_CREST_BY_ALIAS[key];
  // Strip common suffixes for StatPal short names
  const stripped = key
    .replace(/\s+fc$/i, '')
    .replace(/\s+cf$/i, '')
    .replace(/\s+sk$/i, '')
    .trim();
  if (stripped !== key && TEAM_CREST_BY_ALIAS[stripped]) return TEAM_CREST_BY_ALIAS[stripped];
  return null;
}

export function resolveTeamCrest(
  teamName: string | null | undefined,
  fromDb: string | null | undefined
): string | null {
  const trimmed = fromDb?.trim();
  if (trimmed) return trimmed;
  return fallbackTeamCrestUrl(teamName);
}
