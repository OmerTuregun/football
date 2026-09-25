export type GameModeId = 'general' | 'cl' | 'ec' | 'wc' | 'top5';

export interface GameMode {
  id: GameModeId;
  label: string;
  competitionIds: number[] | null;
}

export const GAME_MODES: GameMode[] = [
  { id: 'general', label: 'Genel', competitionIds: null },
  { id: 'cl', label: 'Şampiyonlar Ligi', competitionIds: [2001] },
  { id: 'ec', label: 'Euro 2024', competitionIds: [2018] },
  { id: 'wc', label: 'Dünya Kupası 2026', competitionIds: [2000] },
  {
    id: 'top5',
    label: '5 Büyük Lig',
    competitionIds: [2021, 2002, 2014, 2019, 2015],
  },
];

export const MAX_GUESSES = 8;

/** National-team tournaments — not used for "kulüp" resolution. */
export const INTERNATIONAL_COMPETITION_CODES = ['EC', 'WC'] as const;

/** Continental / national-team comps — not shown as the player's domestic league. */
export const NON_DOMESTIC_LEAGUE_CODES = ['CL', 'EL', 'ECL', 'EC', 'WC'] as const;

export function getGameMode(modeId: string): GameMode {
  const mode = GAME_MODES.find((m) => m.id === modeId);
  if (!mode) {
    throw new Error(`Unknown game mode: ${modeId}`);
  }
  return mode;
}

export function isValidGameMode(modeId: string): modeId is GameModeId {
  return GAME_MODES.some((m) => m.id === modeId);
}
