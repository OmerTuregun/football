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

interface GameCardProps {
  game: SiteGame;
}

export function GameCard({ game }: GameCardProps) {
  const Icon = ICONS[game.icon];

  const inner = (
    <>
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-card ${
          game.active ? 'bg-brand-light text-brand-dark' : 'bg-sidebar text-muted-light'
        }`}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2
        className={`mt-4 text-[15px] font-medium ${
          game.active ? 'text-ink' : 'text-muted-light'
        }`}
      >
        {game.name}
      </h2>
      {game.active && <p className="mt-2 text-[13px] text-muted">Oyna →</p>}
    </>
  );

  if (game.active) {
    return (
      <Link
        href={game.href}
        className="rounded-card border border-line bg-page p-5 transition hover:border-brand-border hover:shadow-sm"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="rounded-card border border-line bg-page p-5 opacity-70">{inner}</div>
  );
}
