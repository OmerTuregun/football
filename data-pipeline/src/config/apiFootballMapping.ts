/** Our competition codes → API-Football league IDs (v3). */
export const API_FOOTBALL_LEAGUE_IDS: Record<string, number> = {
  // 2 — UEFA Champions League
  CL: 2,
  // 39 — Premier League (England)
  PL: 39,
  // 78 — Bundesliga (Germany)
  BL1: 78,
  // 140 — La Liga (Spain)
  PD: 140,
  // 135 — Serie A (Italy)
  SA: 135,
  // 61 — Ligue 1 (France)
  FL1: 61,
  // 4 — UEFA European Championship
  EC: 4,
  // 1 — FIFA World Cup
  WC: 1,
};

export function getApiFootballLeagueId(competitionCode: string): number | undefined {
  return API_FOOTBALL_LEAGUE_IDS[competitionCode.toUpperCase()];
}
