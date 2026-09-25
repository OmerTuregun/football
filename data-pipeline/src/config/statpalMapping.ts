/** StatPal league IDs and import priority (Adım 0 verified). */
export const STATPAL_TARGET_SEASONS = ['2024-2025', '2025-2026', '2026-2027'] as const;

export type StatPalCompetitionCode =
  | 'CL'
  | 'PL'
  | 'PD'
  | 'SL'
  | 'BL1'
  | 'SA'
  | 'FL1'
  | 'EL'
  | 'PPL'
  | 'DED'
  | 'ECL';

export interface StatPalLeagueConfig {
  code: StatPalCompetitionCode;
  label: string;
  leagueId: string;
  statpalName: string;
}

/** Import order: CL first → Conference League last. */
export const STATPAL_LEAGUES: StatPalLeagueConfig[] = [
  { code: 'CL', label: 'Champions League', leagueId: '2838', statpalName: 'UEFA Champions League' },
  { code: 'PL', label: 'Premier League', leagueId: '3037', statpalName: 'Premier League' },
  { code: 'PD', label: 'La Liga', leagueId: '3232', statpalName: 'Primera' },
  { code: 'SL', label: 'Süper Lig', leagueId: '3258', statpalName: 'Super Lig' },
  { code: 'BL1', label: 'Bundesliga', leagueId: '3062', statpalName: 'Bundesliga' },
  { code: 'SA', label: 'Serie A', leagueId: '3102', statpalName: 'Serie A' },
  { code: 'FL1', label: 'Ligue 1', leagueId: '3054', statpalName: 'Ligue 1' },
  { code: 'EL', label: 'Europa League', leagueId: '2840', statpalName: 'UEFA Europa League' },
  { code: 'PPL', label: 'Primeira Liga', leagueId: '3185', statpalName: 'Portuguese Liga' },
  { code: 'DED', label: 'Eredivisie', leagueId: '3155', statpalName: 'Eredivisie' },
  { code: 'ECL', label: 'Conference League', leagueId: '20686', statpalName: 'Europa Conference League' },
];

export type StatPalPhase = 'teams' | 'players' | 'matches' | 'lineups' | 'teammates';

export const STATPAL_PHASES: StatPalPhase[] = [
  'teams',
  'players',
  'matches',
  'lineups',
  'teammates',
];

export function seasonStartYear(season: string): number {
  const m = season.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
}

export function getLeagueByCode(code: string): StatPalLeagueConfig | undefined {
  return STATPAL_LEAGUES.find((l) => l.code === code.toUpperCase());
}

/** football-data.org crest URLs for competitions created without emblem metadata. */
export const STATPAL_LEAGUE_EMBLEMS: Partial<Record<StatPalCompetitionCode, string>> = {
  SL: 'https://crests.football-data.org/524.png',
  PPL: 'https://crests.football-data.org/PPL.png',
  DED: 'https://crests.football-data.org/ED.png',
  EL: 'https://crests.football-data.org/EL.png',
  ECL: 'https://crests.football-data.org/2004.png',
  CL: 'https://crests.football-data.org/CL.png',
};
