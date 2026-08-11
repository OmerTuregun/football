'use client';

import { useEffect, useRef, useState } from 'react';

interface GameTimerProps {
  enabled: boolean;
  limitSec: number;
  running: boolean;
  onExpire: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function GameTimer({ enabled, limitSec, running, onExpire }: GameTimerProps) {
  const [remaining, setRemaining] = useState(limitSec);
  const expiredRef = useRef(false);

  useEffect(() => {
    setRemaining(limitSec);
    expiredRef.current = false;
  }, [limitSec, enabled]);

  useEffect(() => {
    if (!enabled || !running || remaining <= 0) return;
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          window.clearInterval(id);
          if (!expiredRef.current) {
            expiredRef.current = true;
            onExpire();
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [enabled, running, remaining, onExpire]);

  if (!enabled) return null;

  const urgent = remaining <= 30;

  return (
    <div
      className={`inline-flex items-center rounded-pill border px-2.5 py-1 text-[12px] font-semibold tabular-nums ${
        urgent
          ? 'border-miss-dark/40 bg-miss-light text-miss-dark'
          : 'border-line bg-sidebar text-ink'
      }`}
    >
      {formatTime(remaining)}
    </div>
  );
}
