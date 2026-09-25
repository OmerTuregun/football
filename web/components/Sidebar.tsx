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
    <aside className="relative flex h-full w-[232px] shrink-0 flex-col border-r border-line/70 bg-sidebar/95 backdrop-blur-sm">
      <div className="px-5 py-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
              <path
                d="M12 3c2.2 2.4 3.5 5.5 3.5 9s-1.3 6.6-3.5 9c-2.2-2.4-3.5-5.5-3.5-9S9.8 5.4 12 3Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M3.5 9.5h17M3.5 14.5h17"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold tracking-tight text-ink">Futbolistan</span>
            <span className="text-[11px] text-muted">Günlük futbol oyunları</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 pb-6">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-light">
          Oyunlar
        </p>
        <ul className="space-y-1">
          {SITE_GAMES.map((game) => {
            const Icon = ICONS[game.icon];
            const isCurrent =
              game.active && (pathname === game.href || pathname.startsWith(`${game.href}/`));

            if (game.active) {
              return (
                <li key={game.id}>
                  <Link
                    href={game.href}
                    className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition ${
                      isCurrent
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-ink hover:bg-brand-light/80 hover:text-brand-dark'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${isCurrent ? 'text-white' : 'text-brand-dark/80'}`}
                      strokeWidth={1.85}
                    />
                    <span className="leading-tight">{game.shortName}</span>
                  </Link>
                </li>
              );
            }

            return (
              <li key={game.id}>
                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-muted-light"
                  aria-disabled
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="leading-tight">{game.shortName}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
