'use client';

import { useEffect, useState } from 'react';

import { DIFFICULTIES, type DifficultyId } from '@/lib/difficulty-config';
import {
  getOfficialPlayRecord,
  hasOfficialPlayToday,
  isArchiveDate,
  isToday,
  type DailyGameId,
} from '@/lib/daily-access';
import { setTimerEnabled } from '@/lib/game-preferences';

import { DailyArchivePicker } from './DailyArchivePicker';

interface GameSetupPanelProps {
  gameId: DailyGameId;
  date: string;
  onDateChange: (date: string) => void;
  difficulty: DifficultyId;
  onDifficultyChange: (d: DifficultyId) => void;
  timerEnabled: boolean;
  onTimerEnabledChange: (v: boolean) => void;
  disabled?: boolean;
  showDifficulty?: boolean;
  children?: React.ReactNode;
}

export function GameSetupPanel({
  gameId,
  date,
  onDateChange,
  difficulty,
  onDifficultyChange,
  timerEnabled,
  onTimerEnabledChange,
  disabled,
  showDifficulty = true,
  children,
}: GameSetupPanelProps) {
  const [officialBlocked, setOfficialBlocked] = useState(false);
  const [officialRecord, setOfficialRecord] = useState<
    ReturnType<typeof getOfficialPlayRecord>
  >(null);

  useEffect(() => {
    setOfficialBlocked(hasOfficialPlayToday(gameId, date));
    setOfficialRecord(getOfficialPlayRecord(gameId, date));
  }, [gameId, date]);

  const handleTimerToggle = (next: boolean) => {
    setTimerEnabled(next);
    onTimerEnabledChange(next);
  };

  return (
    <div className="space-y-3">
      {showDifficulty && (
        <div className="flex flex-wrap gap-1.5">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onDifficultyChange(d.id)}
              disabled={disabled}
              className={`rounded-pill px-3 py-1 text-[12px] font-medium transition ${
                difficulty === d.id
                  ? 'bg-brand text-white'
                  : 'bg-sidebar text-muted hover:bg-brand-light hover:text-brand-dark'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
        <input
          type="checkbox"
          checked={timerEnabled}
          onChange={(e) => handleTimerToggle(e.target.checked)}
          disabled={disabled}
          className="rounded border-line"
        />
        Süre sınırı ({timerEnabled ? 'açık' : 'kapalı'})
      </label>

      {isToday(date) && officialBlocked && officialRecord && (
        <div className="rounded-card border border-brand-border bg-brand-light px-3 py-2 text-[12px] text-brand-dark">
          Bugünkü resmi turu oynadın ({officialRecord.status === 'won' ? 'kazandın' : 'kaybettin'}).
          Geçmiş günlerden pratik yapabilirsin.
        </div>
      )}

      {isArchiveDate(date) && (
        <p className="text-[11px] text-muted">Arşiv modu — temiz tahta, sınırsız pratik.</p>
      )}

      {/* Gün navigasyonu - sol panelin alt kısmı */}
      <DailyArchivePicker date={date} onDateChange={onDateChange} disabled={disabled} />

      {children}
    </div>
  );
}
