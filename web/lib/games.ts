export type GameIconId =
  | 'user-search'
  | 'arrow-up-down'
  | 'grid-3x3'
  | 'map'
  | 'shirt'
  | 'list-ordered'
  | 'layout-grid';

export interface SiteGame {
  id: string;
  name: string;
  icon: GameIconId;
  href: string;
  active: boolean;
}

export const SITE_GAMES: SiteGame[] = [
  {
    id: 'daily-player',
    name: 'Günlük Oyuncu Tahmini',
    icon: 'user-search',
    href: '/oyunlar/gunluk-oyuncu-tahmini',
    active: true,
  },
  {
    id: 'higher-lower',
    name: 'Higher or Lower',
    icon: 'arrow-up-down',
    href: '/oyunlar/higher-or-lower',
    active: true,
  },
  {
    id: 'missing-xi',
    name: 'Kayıp 11',
    icon: 'shirt',
    href: '/oyunlar/kayip-11',
    active: true,
  },
  {
    id: 'career-path',
    name: 'Kariyer Rotası',
    icon: 'map',
    href: '/oyunlar/kariyer-rotasi',
    active: true,
  },
  {
    id: 'club-grid',
    name: 'Kulüp Grid Bulmacası',
    icon: 'grid-3x3',
    href: '/oyunlar/kulup-grid',
    active: true,
  },
  {
    id: 'onluk',
    name: 'Onluk',
    icon: 'list-ordered',
    href: '/oyunlar/onluk',
    active: true,
  },
  {
    id: 'connections',
    name: 'Bağlantılar',
    icon: 'layout-grid',
    href: '/oyunlar/baglantilar',
    active: true,
  },
];
