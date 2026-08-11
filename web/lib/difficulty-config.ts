export type DifficultyId = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: { id: DifficultyId; label: string; hint: string }[] = [
  { id: 'easy', label: 'Kolay', hint: 'Real, Barça, City, Bayern… gibi elit kulüpler' },
  { id: 'medium', label: 'Orta', hint: 'Üst lig + bilinen kulüp oyuncuları' },
  { id: 'hard', label: 'Zor', hint: 'Havuzdaki herkes (milli adaylar dahil)' },
];

export function isValidDifficulty(value: string): value is DifficultyId {
  return value === 'easy' || value === 'medium' || value === 'hard';
}
