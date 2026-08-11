'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { getTodayDateString } from '@/lib/daily-hash';
import { isArchiveDate, isToday } from '@/lib/daily-access';

interface DailyArchivePickerProps {
  date: string;
  onDateChange: (date: string) => void;
  disabled?: boolean;
}

function formatCompactDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}.${m}.${y}`;
}

export function DailyArchivePicker({ date, onDateChange, disabled }: DailyArchivePickerProps) {
  const today = getTodayDateString();
  const archiveDaysBack = 10;

  // "Son 10 gün + bugün" → toplam 11 kayıt
  const dates: string[] = [];
  const base = new Date(`${today}T12:00:00.000Z`);
  for (let i = archiveDaysBack; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const idx = Math.max(0, dates.indexOf(date));
  const canPrev = idx > 0;
  const canNext = idx < dates.length - 1;

  const prevDate = canPrev ? dates[idx - 1] : date;
  const nextDate = canNext ? dates[idx + 1] : date;

  return (
    <div className="space-y-2">
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
        Gün
      </label>
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-sidebar/50 px-3 py-2">
        <button
          type="button"
          onClick={() => onDateChange(prevDate)}
          disabled={disabled || !canPrev}
          aria-label="Önceki gün"
          className="rounded-pill border border-line bg-page px-3 py-1.5 text-[12px] font-semibold text-muted disabled:opacity-40"
        >
          <ChevronLeft className="inline-block h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-col items-center justify-center text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {idx + 1} / {dates.length}
          </p>
          <p className="truncate text-[13px] font-medium text-ink">
            {isToday(date) ? 'Bugün' : formatCompactDate(date)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onDateChange(nextDate)}
          disabled={disabled || !canNext}
          aria-label="Sonraki gün"
          className="rounded-pill border border-line bg-page px-3 py-1.5 text-[12px] font-semibold text-muted disabled:opacity-40"
        >
          <ChevronRight className="inline-block h-4 w-4" />
        </button>
      </div>

      {isToday(date) && <p className="text-[10px] text-muted">Bugün oyun türü başına 1 resmi hak.</p>}
      {isArchiveDate(date) && <p className="text-[10px] text-muted">Seçilen günün bulmacası, temiz tahta.</p>}
    </div>
  );
}
