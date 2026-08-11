'use client';

import { useCallback, useState } from 'react';

import {
  isGameStartBlocked,
  isToday,
  markOfficialPlayed,
  shouldPersistGameState,
  type DailyGameId,
} from '@/lib/daily-access';
import { getTodayDateString } from '@/lib/daily-hash';
import { getDefaultTimerSeconds, getTimerEnabled } from '@/lib/game-preferences';

export function useGameShell(gameId: DailyGameId) {
  const [date, setDate] = useState(getTodayDateString);
  const [timerEnabled, setTimerEnabled] = useState(() => getTimerEnabled());
  const timerLimitSec = getDefaultTimerSeconds(gameId);

  const canStart = !isGameStartBlocked(gameId, date);
  const persistState = shouldPersistGameState(date);

  const recordOfficialResult = useCallback(
    (status: 'won' | 'lost') => {
      if (isToday(date)) {
        markOfficialPlayed(gameId, date, status);
      }
    },
    [gameId, date]
  );

  return {
    date,
    setDate,
    timerEnabled,
    setTimerEnabled,
    timerLimitSec,
    canStart,
    persistState,
    recordOfficialResult,
    session: 0 as const,
  };
}
