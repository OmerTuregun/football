import type { DifficultyId } from './difficulty-config';

export const ONLUK_SIZE = 10;
export const ONLUK_LIVES = 3;
/** Onluk always uses medium difficulty; no user-facing difficulty selection. */
export const ONLUK_DIFFICULTY: DifficultyId = 'medium';

export type OnlukQuestionKind =
  | 'club-appearances'
  | 'teammate-appearances'
  | 'competition-goals';
