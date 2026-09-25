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
  /** Kısa menü etiketi (sidebar) */
  shortName: string;
  /** Kart altı tek cümle */
  blurb: string;
  icon: GameIconId;
  href: string;
  active: boolean;
  /** Accent for icon tile */
  accent: 'pitch' | 'sky' | 'clay' | 'ink' | 'gold' | 'rose' | 'teal';
}

export const SITE_GAMES: SiteGame[] = [
  {
    id: 'daily-player',
    name: 'Günlük Oyuncu',
    shortName: 'Günlük Oyuncu',
    blurb: '6 ipucu kartıyla günün futbolcusunu bul.',
    icon: 'user-search',
    href: '/oyunlar/gunluk-oyuncu-tahmini',
    active: true,
    accent: 'pitch',
  },
  {
    id: 'higher-lower',
    name: 'Higher or Lower',
    shortName: 'Higher / Lower',
    blurb: 'İstatistikte yukarı mı, aşağı mı? Serini koru.',
    icon: 'arrow-up-down',
    href: '/oyunlar/higher-or-lower',
    active: true,
    accent: 'sky',
  },
  {
    id: 'missing-xi',
    name: 'Kayıp 11',
    shortName: 'Kayıp 11',
    blurb: 'Sahadaki eksik 11’i tamamla.',
    icon: 'shirt',
    href: '/oyunlar/kayip-11',
    active: true,
    accent: 'pitch',
  },
  {
    id: 'career-path',
    name: 'Kariyer Rotası',
    shortName: 'Kariyer',
    blurb: 'Kulüp yolundan oyuncuyu tanı.',
    icon: 'map',
    href: '/oyunlar/kariyer-rotasi',
    active: true,
    accent: 'clay',
  },
  {
    id: 'club-grid',
    name: 'Kulüp Grid',
    shortName: 'Kulüp Grid',
    blurb: 'İki kulübü kesiştiren isimleri yerleştir.',
    icon: 'grid-3x3',
    href: '/oyunlar/kulup-grid',
    active: true,
    accent: 'teal',
  },
  {
    id: 'onluk',
    name: 'Onluk',
    shortName: 'Onluk',
    blurb: 'Son 3 sezonun ilk 10’unu sırayla doldur.',
    icon: 'list-ordered',
    href: '/oyunlar/onluk',
    active: true,
    accent: 'gold',
  },
  {
    id: 'connections',
    name: 'Bağlantılar',
    shortName: 'Bağlantılar',
    blurb: '16 oyuncuyu 4 gizli gruba ayır.',
    icon: 'layout-grid',
    href: '/oyunlar/baglantilar',
    active: true,
    accent: 'rose',
  },
];
