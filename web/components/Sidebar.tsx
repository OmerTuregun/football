'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowUpDown,
  Grid3x3,
  LayoutGrid,
  ListOrdered,
  Map,
  Shirt,
  UserSearch,
  Volleyball,
  type LucideIcon,
} from 'lucide-react';

import { SITE_GAMES, type GameIconId } from '@/lib/games';

const ICONS: Record<GameIconId, LucideIcon> = {
  'user-search': UserSearch,
  'arrow-up-down': ArrowUpDown,
  'grid-3x3': Grid3x3,
  map: Map,
  shirt: Shirt,
  'list-ordered': ListOrdered,
  'layout-grid': LayoutGrid,
};

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="px-5 py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Volleyball className="h-5 w-5 text-brand" strokeWidth={1.75} />
          <span className="text-[15px] font-medium text-ink">Futbolistan</span>
        </Link>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-0.5">
          {SITE_GAMES.map((game) => {
            const Icon = ICONS[game.icon];
            const isCurrent = game.active && pathname === game.href;

            if (game.active) {
              return (
                <li key={game.id}>
                  <Link
                    href={game.href}
                    className={`flex items-center gap-2.5 rounded-card px-3 py-2 text-[13px] font-medium transition ${
                      isCurrent
                        ? 'bg-brand-light text-brand-dark'
                        : 'text-ink hover:bg-brand-light/60'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="leading-tight">{game.name}</span>
                  </Link>
                </li>
              );
            }

            return (
              <li key={game.id}>
                <div
                  className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-muted-light"
                  aria-disabled
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="leading-tight">{game.name}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
