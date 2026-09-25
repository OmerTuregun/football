'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

import { GAME_HELP } from '@/lib/game-help';
import type { DailyGameId } from '@/lib/daily-access';

interface GameHelpButtonProps {
  gameId: DailyGameId;
  /** Optional larger hit area next to big titles */
  size?: 'sm' | 'md';
}

export function GameHelpButton({ gameId, size = 'md' }: GameHelpButtonProps) {
  const help = GAME_HELP[gameId];
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!help) return null;

  const btnClass =
    size === 'sm'
      ? 'h-6 w-6'
      : 'h-7 w-7';
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-white/90 text-muted transition hover:border-brand-border hover:bg-brand-light hover:text-brand-dark ${btnClass}`}
        aria-label={`${help.title} nasıl oynanır?`}
        title="Nasıl oynanır?"
      >
        <HelpCircle className={iconClass} strokeWidth={2} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[min(80vh,520px)] w-full max-w-sm overflow-y-auto rounded-[12px] border border-line bg-page p-5 shadow-2xl outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Nasıl oynanır?
                </p>
                <h2 id={titleId} className="mt-1 text-[17px] font-semibold text-ink">
                  {help.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-sidebar hover:text-ink"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-muted">{help.summary}</p>

            <ol className="mt-4 list-decimal space-y-2 pl-4 text-[13px] leading-relaxed text-ink">
              {help.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            {help.tip && (
              <p className="mt-4 rounded-card border border-brand-border/60 bg-brand-light/70 px-3 py-2 text-[12px] leading-relaxed text-brand-dark">
                <span className="font-semibold">İpucu: </span>
                {help.tip}
              </p>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 w-full rounded-card bg-brand px-4 py-2.5 text-[13px] font-medium text-white hover:bg-brand-dark"
            >
              Anladım
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface GameTitleProps {
  gameId: DailyGameId;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}

/** Title row with inline help (?) control. */
export function GameTitle({ gameId, children, className, size = 'md' }: GameTitleProps) {
  return (
    <div className="flex items-center gap-2">
      <h1 className={className}>{children}</h1>
      <GameHelpButton gameId={gameId} size={size} />
    </div>
  );
}
