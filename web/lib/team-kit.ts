/** Approximate kit colors from team name (StatPal teams often lack club_colors). */

export interface KitColors {
  primary: string;
  secondary: string;
  number: string;
  stripe?: boolean;
}

const DEFAULT_KIT: KitColors = {
  primary: '#1e3a5f',
  secondary: '#ffffff',
  number: '#ffffff',
};

const KITS: Array<{ match: RegExp; kit: KitColors }> = [
  { match: /bayern|münchen|munchen/i, kit: { primary: '#DC052D', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /dortmund/i, kit: { primary: '#FDE100', secondary: '#000000', number: '#000000' } },
  { match: /leverkusen|bayer 04/i, kit: { primary: '#E32221', secondary: '#000000', number: '#FFFFFF' } },
  { match: /real madrid/i, kit: { primary: '#FFFFFF', secondary: '#00529F', number: '#00529F' } },
  { match: /barcelona|barça/i, kit: { primary: '#A50044', secondary: '#004D98', number: '#FFFFFF', stripe: true } },
  { match: /atl[eé]tico/i, kit: { primary: '#CE3524', secondary: '#FFFFFF', number: '#FFFFFF', stripe: true } },
  { match: /manchester city|man city/i, kit: { primary: '#6CABDD', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /manchester united|man united|man utd/i, kit: { primary: '#DA291C', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /liverpool/i, kit: { primary: '#C8102E', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /arsenal/i, kit: { primary: '#EF0107', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /chelsea/i, kit: { primary: '#034694', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /tottenham|spurs/i, kit: { primary: '#FFFFFF', secondary: '#132257', number: '#132257' } },
  { match: /juventus/i, kit: { primary: '#000000', secondary: '#FFFFFF', number: '#FFFFFF', stripe: true } },
  { match: /inter(?! miami)|internazionale/i, kit: { primary: '#0068A8', secondary: '#000000', number: '#FFFFFF', stripe: true } },
  { match: /\bac milan\b|^milan$|milan ac/i, kit: { primary: '#FB090B', secondary: '#000000', number: '#FFFFFF', stripe: true } },
  { match: /napoli/i, kit: { primary: '#12A0D7', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /paris|psg/i, kit: { primary: '#004170', secondary: '#DA291C', number: '#FFFFFF' } },
  { match: /ajax/i, kit: { primary: '#D2122E', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /\bpsv\b/i, kit: { primary: '#E03A3E', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /benfica/i, kit: { primary: '#E32636', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /porto/i, kit: { primary: '#003893', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /sporting/i, kit: { primary: '#008057', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /galatasaray/i, kit: { primary: '#A90432', secondary: '#FDB912', number: '#FFFFFF' } },
  { match: /fenerbah/i, kit: { primary: '#00205B', secondary: '#FDB913', number: '#FFFFFF' } },
  { match: /be[sş]ikta[sş]/i, kit: { primary: '#000000', secondary: '#FFFFFF', number: '#FFFFFF', stripe: true } },
  { match: /leipzig/i, kit: { primary: '#DD074F', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /atalanta/i, kit: { primary: '#1B2F5C', secondary: '#007FFF', number: '#FFFFFF' } },
  { match: /roma/i, kit: { primary: '#8E1F2F', secondary: '#F0AF00', number: '#FFFFFF' } },
  { match: /lazio/i, kit: { primary: '#87D8F7', secondary: '#FFFFFF', number: '#00205B' } },
  { match: /sevilla/i, kit: { primary: '#FFFFFF', secondary: '#D4AF37', number: '#C8102E' } },
  { match: /newcastle/i, kit: { primary: '#000000', secondary: '#FFFFFF', number: '#FFFFFF', stripe: true } },
  { match: /monaco/i, kit: { primary: '#E30613', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /marseille/i, kit: { primary: '#2BB6E7', secondary: '#FFFFFF', number: '#FFFFFF' } },
  { match: /lyon/i, kit: { primary: '#FFFFFF', secondary: '#003399', number: '#DA291C' } },
];

const GK_KIT: KitColors = {
  primary: '#F5C518',
  secondary: '#1A1A18',
  number: '#1A1A18',
};

export function kitForTeam(name: string, isGoalkeeper = false): KitColors {
  if (isGoalkeeper) return GK_KIT;
  for (const entry of KITS) {
    if (entry.match.test(name)) return entry.kit;
  }
  return DEFAULT_KIT;
}

export function contrastText(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#FFFFFF';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#1A1A18' : '#FFFFFF';
}
