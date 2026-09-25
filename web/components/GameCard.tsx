import Link from 'next/link';
import {
  ArrowUpDown,
  Grid3x3,
  LayoutGrid,
  ListOrdered,
  Map,
  Shirt,
  UserSearch,
  type LucideIcon,
} from 'lucide-react';

import type { GameIconId, SiteGame } from '@/lib/games';

const ICONS: Record<GameIconId, LucideIcon> = {
  'user-search': UserSearch,
  'arrow-up-down': ArrowUpDown,
  'grid-3x3': Grid3x3,
  map: Map,
  shirt: Shirt,
  'list-ordered': ListOrdered,
  'layout-grid': LayoutGrid,
};

const ACCENT: Record<
  SiteGame['accent'],
  { tile: string; icon: string; glow: string }
> = {
  pitch: {
    tile: 'bg-[#EAF3DE]',
    icon: 'text-[#27500A]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(59,109,17,0.45)]',
  },
  sky: {
    tile: 'bg-[#E4EEF7]',
    icon: 'text-[#1E4A6E]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(30,74,110,0.35)]',
  },
  clay: {
    tile: 'bg-[#F3E8DC]',
    icon: 'text-[#6B3F1E]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(107,63,30,0.35)]',
  },
  ink: {
    tile: 'bg-[#ECEAE4]',
    icon: 'text-[#2A2A26]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(26,26,24,0.3)]',
  },
  gold: {
    tile: 'bg-[#F5EED8]',
    icon: 'text-[#6A5420]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(106,84,32,0.35)]',
  },
  rose: {
    tile: 'bg-[#F6E6E6]',
    icon: 'text-[#6B2A2A]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(107,42,42,0.3)]',
  },
  teal: {
    tile: 'bg-[#E2F0EC]',
    icon: 'text-[#1F5A4A]',
    glow: 'group-hover:shadow-[0_12px_28px_-12px_rgba(31,90,74,0.35)]',
  },
};

interface GameCardProps {
  game: SiteGame;
}

export function GameCard({ game }: GameCardProps) {
  const Icon = ICONS[game.icon];
  const accent = ACCENT[game.accent];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-[10px] ${accent.tile} ${accent.icon}`}
        >
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        {game.active && (
          <span className="rounded-pill bg-brand-light px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-dark">
            Oyna
          </span>
        )}
      </div>
      <h2
        className={`mt-4 text-[17px] font-semibold tracking-tight ${
          game.active ? 'text-ink' : 'text-muted-light'
        }`}
      >
        {game.name}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{game.blurb}</p>
    </>
  );

  if (game.active) {
    return (
      <Link
        href={game.href}
        className={`group relative overflow-hidden rounded-[12px] border border-line/80 bg-white/85 p-5 backdrop-blur-[2px] transition duration-300 hover:-translate-y-0.5 hover:border-brand-border ${accent.glow}`}
      >
        <div
          className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12]"
          style={{
            background:
              'radial-gradient(circle at center, currentColor 0%, transparent 70%)',
          }}
          aria-hidden
        />
        {inner}
      </Link>
    );
  }

  return (
    <div className="rounded-[12px] border border-line bg-white/60 p-5 opacity-70">{inner}</div>
  );
}
