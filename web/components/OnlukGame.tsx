'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Heart } from 'lucide-react';

import { getOfficialPlayRecord, isGameStartBlocked, shouldPersistGameState } from '@/lib/daily-access';
import { ONLUK_DIFFICULTY, ONLUK_LIVES, ONLUK_SIZE } from '@/lib/onluk-shared';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTitle } from '@/components/GameHelpButton';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';

interface OnlukAnswer {
  rank: number;
  playerId: number;
  name: string;
  value: number;
  valueLabel: string;
}

interface OnlukPuzzlePublic {
  kind: string;
  title: string;
  note: string;
  subtitle: string;
  crestA: string | null;
  crestB: string | null;
  unit: string;
  targetCount: number;
  lives: number;
  seasonFrom: number;
  seasonTo: number;
  date: string;
  session: number;
}

interface GuessResult {
  correct: boolean;
  livesLeft: number;
  streakCorrect: number;
  placed: OnlukAnswer | null;
  placedCount: number;
  won: boolean;
  lost: boolean;
  gameOver: boolean;
}

interface SearchResult {
  id: number;
  name: string;
  nationality: string;
  position: string;
  club: string;
  clubCrest: string | null;
}

interface StoredGameState {
  date: string;
  session: number;
  title: string;
  note: string;
  subtitle: string;
  crestA: string | null;
  crestB: string | null;
  unit: string;
  slots: Array<OnlukAnswer | null>;
  livesLeft: number;
  streakCorrect: number;
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
  /** Correctly guessed player ids (survives reveal for green vs yellow) */
  foundIds?: number[];
}

const SCAN_ORDER = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] as const;
const SCAN_STEP_MS = 110;
const HIT_HOLD_MS = 420;
const MISS_FLASH_MS = 520;

function storageKey(date: string, session: number): string {
  return `football-onluk:v4:${date}:${session}`;
}

function sessionMetaKey(date: string): string {
  return `football-onluk:v4:session:${date}`;
}

function emptySlots(): Array<OnlukAnswer | null> {
  return Array.from({ length: ONLUK_SIZE }, () => null);
}

function parseStoredState(raw: string, date: string, session: number): StoredGameState | null {
  try {
    const parsed = JSON.parse(raw) as StoredGameState;
    if (parsed.date !== date || parsed.session !== session) return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadState(date: string, session: number): StoredGameState | null {
  if (typeof window === 'undefined') return null;
  const v4 = localStorage.getItem(storageKey(date, session));
  if (v4) {
    const parsed = parseStoredState(v4, date, session);
    if (parsed) return parsed;
  }
  // Legacy saves before difficulty was removed (v3)
  for (const diff of ['medium', 'easy', 'hard'] as const) {
    const legacy = localStorage.getItem(`football-onluk:v3:${diff}:${date}:${session}`);
    if (!legacy) continue;
    const parsed = parseStoredState(legacy, date, session);
    if (parsed) return parsed;
  }
  return null;
}

function saveState(state: StoredGameState): void {
  if (!shouldPersistGameState(state.date)) return;
  localStorage.setItem(storageKey(state.date, state.session), JSON.stringify(state));
  localStorage.setItem(sessionMetaKey(state.date), String(state.session));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function OnlukGame() {
  const shell = useGameShell('onluk');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [session, setSession] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [crestA, setCrestA] = useState<string | null>(null);
  const [crestB, setCrestB] = useState<string | null>(null);
  const [unit, setUnit] = useState('maç');
  const [slots, setSlots] = useState<Array<OnlukAnswer | null>>(emptySlots);
  const [livesLeft, setLivesLeft] = useState(ONLUK_LIVES);
  const [streakCorrect, setStreakCorrect] = useState(0);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [gaveUp, setGaveUp] = useState(false);
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [foundIds, setFoundIds] = useState<number[]>([]);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);

  const [scanIndex, setScanIndex] = useState<number | null>(null);
  const [scanLabel, setScanLabel] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<'idle' | 'hover' | 'hit' | 'miss'>('idle');
  const [boardMiss, setBoardMiss] = useState(false);
  const [lifePing, setLifePing] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bootRef = useRef(false);

  const placedCount = slots.filter(Boolean).length;
  const usedIds = useMemo(
    () => new Set(slots.filter((s): s is OnlukAnswer => !!s).map((s) => s.playerId)),
    [slots]
  );

  const persist = useCallback(
    (
      partial: Partial<StoredGameState> &
        Pick<StoredGameState, 'slots' | 'livesLeft' | 'status' | 'streakCorrect'>
    ) => {
      saveState({
        date,
        session,
        title,
        note,
        subtitle,
        crestA,
        crestB,
        unit,
        slots: partial.slots,
        livesLeft: partial.livesLeft,
        streakCorrect: partial.streakCorrect,
        status: partial.status,
        gaveUp: partial.gaveUp ?? gaveUp,
        foundIds: partial.foundIds ?? foundIds,
      });
    },
    [date, session, title, note, subtitle, crestA, crestB, unit, gaveUp, foundIds]
  );

  const applyPuzzle = useCallback(
    (puzzle: OnlukPuzzlePublic, restored?: StoredGameState | null) => {
      setTitle(puzzle.title);
      setNote(puzzle.note);
      setSubtitle(puzzle.subtitle);
      setCrestA(puzzle.crestA);
      setCrestB(puzzle.crestB);
      setUnit(puzzle.unit);
      if (restored && restored.title === puzzle.title) {
        setSlots(restored.slots);
        setLivesLeft(restored.livesLeft);
        setStreakCorrect(restored.streakCorrect ?? 0);
        setStatus(restored.status);
        setGaveUp(!!restored.gaveUp);
        const restoredFound =
          restored.foundIds ??
          (restored.gaveUp
            ? []
            : restored.slots
                .filter((s): s is OnlukAnswer => !!s)
                .map((s) => s.playerId));
        setFoundIds(restoredFound);
        // Returning to a lost game without reveal → ask again
        setLostModalOpen(restored.status === 'lost' && !restored.gaveUp);
      } else {
        setSlots(emptySlots());
        setLivesLeft(puzzle.lives);
        setStreakCorrect(0);
        setStatus('playing');
        setFoundIds([]);
        setGaveUp(false);
        setLostModalOpen(false);
      }
      setQuery('');
      setSuggestions([]);
      setScanIndex(null);
      setScanLabel(null);
      setScanPhase('idle');
      setBoardMiss(false);
    },
    []
  );

  const loadPuzzle = useCallback(
    async (sess: number, preferRestore: boolean) => {
      setLoading(true);
      setError(null);
      const blocked = isGameStartBlocked('onluk', date);
      try {
        const restoreOk = preferRestore && shouldPersistGameState(date);
        const restored = restoreOk ? loadState(date, sess) : null;
        const res = await fetch(`/api/games/onluk/puzzle?date=${date}&session=${sess}`);
        const data = (await res.json()) as OnlukPuzzlePublic & { error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Puzzle yüklenemedi');
        applyPuzzle(data, restored);

        if (blocked && !restored) {
          const official = getOfficialPlayRecord('onluk', date);
          if (official) {
            setStatus(official.status === 'won' ? 'won' : 'lost');
            if (official.status === 'lost') {
              setLivesLeft(0);
              setLostModalOpen(true);
            }
          }
        } else if (!blocked && (!restored || restored.title !== data.title)) {
          saveState({
            date,
            session: sess,
            title: data.title,
            note: data.note,
            subtitle: data.subtitle,
            crestA: data.crestA,
            crestB: data.crestB,
            unit: data.unit,
            slots: emptySlots(),
            livesLeft: data.lives,
            streakCorrect: 0,
            status: 'playing',
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Puzzle yüklenemedi');
      } finally {
        setLoading(false);
      }
    },
    [applyPuzzle, date]
  );

  useEffect(() => {
    bootRef.current = false;
  }, [date]);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    setSession(0);
    void loadPuzzle(0, true);
  }, [date, loadPuzzle]);

  const handleTimerExpire = useCallback(() => {
    if (status !== 'playing' || busy) return;
    setStatus('lost');
    setLostModalOpen(true);
    recordOfficialResult('lost');
    persist({
      slots,
      livesLeft: 0,
      streakCorrect: 0,
      status: 'lost',
    });
  }, [status, busy, slots, recordOfficialResult, persist]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2 || status !== 'playing' || busy) {
      setSuggestions([]);
      setActiveSuggestion(0);
      return;
    }
    const seq = ++searchSeq.current;
    // Short queries debounce a bit more; longer queries feel instant
    const delay = q.length <= 2 ? 120 : 60;
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(q)}&mode=general&limit=8`
        );
        const data = (await res.json()) as { players?: SearchResult[] };
        if (seq !== searchSeq.current) return;
        const next = (data.players ?? []).filter((p) => !usedIds.has(p.id)).slice(0, 8);
        setSuggestions(next);
        setActiveSuggestion(0);
      } catch {
        if (seq !== searchSeq.current) return;
        setSuggestions([]);
      } finally {
        if (seq === searchSeq.current) setSearchLoading(false);
      }
    }, delay);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, status, usedIds, busy]);

  const onDateChange = (next: string) => {
    setDate(next);
    setSession(0);
  };

  const runScan = async (opts: {
    name: string;
    targetRank: number | null;
    onHit?: () => void;
  }) => {
    setScanLabel(opts.name);
    setScanPhase('hover');
    setBoardMiss(false);

    for (const idx of SCAN_ORDER) {
      setScanIndex(idx);
      const isTarget = opts.targetRank !== null && idx === opts.targetRank - 1;
      if (isTarget) {
        setScanPhase('hit');
        opts.onHit?.();
        await sleep(HIT_HOLD_MS);
        break;
      }
      await sleep(SCAN_STEP_MS);
    }

    if (opts.targetRank === null) {
      setScanIndex(null);
      setScanPhase('miss');
      setBoardMiss(true);
      await sleep(MISS_FLASH_MS);
    }

    setScanIndex(null);
    setScanLabel(null);
    setScanPhase('idle');
    setBoardMiss(false);
  };

  const submitGuess = async (player: SearchResult) => {
    if (busy || status !== 'playing') return;
    setBusy(true);
    setQuery('');
    setSuggestions([]);

    try {
      const placedIds = slots.filter((s): s is OnlukAnswer => !!s).map((s) => s.playerId);
      const prevLives = livesLeft;
      const res = await fetch('/api/games/onluk/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          session,
          playerId: player.id,
          placedIds,
          livesLeft,
          streakCorrect,
        }),
      });
      const data = (await res.json()) as GuessResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Tahmin işlenemedi');

      if (data.correct && data.placed) {
        let nextSlots = slots;
        const nextFound = foundIds.includes(data.placed.playerId)
          ? foundIds
          : [...foundIds, data.placed.playerId];
        setFoundIds(nextFound);
        await runScan({
          name: data.placed.name,
          targetRank: data.placed.rank,
          onHit: () => {
            setSlots((prev) => {
              nextSlots = prev.map((s, i) =>
                i === data.placed!.rank - 1 ? data.placed : s
              );
              return nextSlots;
            });
          },
        });

        if (data.livesLeft > prevLives) {
          setLifePing(true);
          window.setTimeout(() => setLifePing(false), 900);
        }

        setLivesLeft(data.livesLeft);
        setStreakCorrect(data.streakCorrect);
        const nextStatus = data.won ? 'won' : 'playing';
        setStatus(nextStatus);
        if (data.won) recordOfficialResult('won');
        persist({
          slots: nextSlots,
          livesLeft: data.livesLeft,
          streakCorrect: data.streakCorrect,
          status: nextStatus,
          foundIds: nextFound,
        });
      } else {
        await runScan({ name: player.name, targetRank: null });
        setLivesLeft(data.livesLeft);
        setStreakCorrect(0);
        const nextStatus = data.lost ? 'lost' : 'playing';
        setStatus(nextStatus);
        if (data.lost) {
          recordOfficialResult('lost');
          // Ensure modal opens after scan/busy clears
          window.setTimeout(() => setLostModalOpen(true), 50);
        }
        persist({
          slots,
          livesLeft: data.livesLeft,
          streakCorrect: 0,
          status: nextStatus,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tahmin işlenemedi');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const revealAnswers = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/games/onluk/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, session }),
      });
      const data = (await res.json()) as {
        answers?: OnlukAnswer[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Cevaplar alınamadı');
      // Keep already-found ids so reveal paints unknowns yellow
      const nextFound = foundIds.length
        ? foundIds
        : slots.filter((s): s is OnlukAnswer => !!s).map((s) => s.playerId);
      setFoundIds(nextFound);
      const nextSlots = emptySlots().map((_, i) => data.answers?.[i] ?? null);
      setSlots(nextSlots);
      setStatus('lost');
      setGaveUp(true);
      setLivesLeft(0);
      setStreakCorrect(0);
      setLostModalOpen(false);
      recordOfficialResult('lost');
      persist({
        slots: nextSlots,
        livesLeft: 0,
        streakCorrect: 0,
        status: 'lost',
        gaveUp: true,
        foundIds: nextFound,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cevaplar alınamadı');
    } finally {
      setBusy(false);
    }
  };

  const giveUp = async () => {
    if (busy || status !== 'playing') return;
    await revealAnswers();
  };

  const dismissLostModal = () => {
    setLostModalOpen(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-8 lg:px-6 lg:py-8">
      <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[280px] lg:self-start">
        <GameTitle gameId="onluk" className="text-[22px] font-semibold tracking-tight text-ink">
          Onluk
        </GameTitle>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Son 3 sezona göre ilk 10. İsim alttan yukarı kutuları gezer; doğruysa yerine oturur.
          İki peş peşe doğru → +1 can (en fazla 3).
        </p>

        <GameSetupPanel
          gameId="onluk"
          date={date}
          onDateChange={onDateChange}
          difficulty={ONLUK_DIFFICULTY}
          onDifficultyChange={() => {}}
          showDifficulty={false}
          timerEnabled={timerEnabled}
          onTimerEnabledChange={setTimerEnabled}
          disabled={busy}
        />

        <div className="mt-3 flex items-center justify-between">
          <GameTimer
            enabled={timerEnabled}
            limitSec={timerLimitSec}
            running={status === 'playing' && !loading}
            onExpire={handleTimerExpire}
          />
        </div>

        <div className="mt-4 rounded-card border border-line bg-sidebar p-3 text-[12px] text-muted">
          <div className="flex items-center justify-between">
            <span>Bulunan</span>
            <span className="font-semibold text-ink">
              {placedCount}/{ONLUK_SIZE}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span>Can</span>
            <span className={`flex gap-0.5 ${lifePing ? 'onluk-life-ping' : ''}`}>
              {Array.from({ length: ONLUK_LIVES }).map((_, i) => (
                <Heart
                  key={i}
                  className={`h-4 w-4 ${
                    i < livesLeft ? 'fill-miss-dark text-miss-dark' : 'text-line'
                  }`}
                  strokeWidth={1.75}
                />
              ))}
            </span>
          </div>
          {streakCorrect > 0 && status === 'playing' && (
            <p className="mt-2 text-[11px] text-brand-dark">
              Seri: {streakCorrect}/2 doğru (can için)
            </p>
          )}
        </div>

        {status === 'playing' && (
          <div className="relative mt-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Oyuncu ara
            </label>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveSuggestion((i) =>
                    suggestions.length ? Math.min(i + 1, suggestions.length - 1) : 0
                  );
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestion((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter' && suggestions.length > 0 && !busy) {
                  e.preventDefault();
                  const pick =
                    suggestions[Math.min(activeSuggestion, suggestions.length - 1)] ??
                    suggestions[0];
                  void submitGuess(pick);
                }
              }}
              disabled={busy}
              placeholder="İsim yaz…"
              className="w-full rounded-card border border-line bg-page px-3 py-2.5 text-[13px] text-ink outline-none ring-brand focus:ring-2 disabled:opacity-50"
              autoComplete="off"
            />
            {(searchLoading || suggestions.length > 0) && (
              <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-card border border-line bg-page shadow-lg">
                {searchLoading && suggestions.length === 0 && (
                  <li className="px-3 py-2 text-[12px] text-muted">Aranıyor…</li>
                )}
                {suggestions.map((p, idx) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onMouseEnter={() => setActiveSuggestion(idx)}
                      onClick={() => void submitGuess(p)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink disabled:opacity-50 ${
                        idx === activeSuggestion ? 'bg-brand-light' : 'hover:bg-brand-light'
                      }`}
                    >
                      {p.clubCrest ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.clubCrest} alt="" className="h-5 w-5 object-contain" />
                      ) : (
                        <span className="h-5 w-5" />
                      )}
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-auto text-[11px] text-muted">{p.club}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {status === 'playing' && (
            <button
              type="button"
              onClick={() => void giveUp()}
              disabled={busy}
              className="rounded-card border border-line px-3 py-2 text-[12px] font-medium text-muted hover:border-miss-dark hover:text-miss-dark disabled:opacity-50"
            >
              Vazgeç / cevapları göster
            </button>
          )}
          {status === 'lost' && !gaveUp && (
            <button
              type="button"
              onClick={() => setLostModalOpen(true)}
              disabled={busy}
              className="rounded-card border border-miss-dark/40 bg-miss-light px-3 py-2 text-[12px] font-semibold text-miss-dark hover:bg-miss-light/80 disabled:opacity-50"
            >
              Cevapları gör
            </button>
          )}
        </div>

        {status === 'won' && (
          <p className="mt-3 text-[13px] font-medium text-brand-dark">Onluğu tamamladın.</p>
        )}
        {status === 'lost' && (
          <p className="mt-3 text-[13px] font-medium text-miss-dark">
            {gaveUp
              ? 'Cevaplar açıldı.'
              : 'Canlar bitti. Cevapları görmek ister misin?'}
          </p>
        )}
        {error && <p className="mt-3 text-[12px] text-miss-dark">{error}</p>}
      </aside>

      {lostModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-[1px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onluk-lost-title"
            className="w-full max-w-sm rounded-card border border-line bg-page p-5 shadow-2xl"
          >
            <h2 id="onluk-lost-title" className="text-[17px] font-semibold text-ink">
              Kaybettin
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Canların bitti. Cevapları şimdi görebilir veya kapatıp görmeden devam edebilirsin.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={dismissLostModal}
                disabled={busy}
                className="rounded-card border border-line px-4 py-2.5 text-[13px] font-medium text-muted hover:text-ink disabled:opacity-50"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => void revealAnswers()}
                disabled={busy}
                className="rounded-card bg-brand px-4 py-2.5 text-[13px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {busy ? 'Yükleniyor…' : 'Cevapları görmek için tıkla'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="min-w-0 flex-1">
        {loading ? (
          <div className="flex h-[480px] items-center justify-center rounded-card border border-line text-muted">
            Yükleniyor…
          </div>
        ) : (
          <div
            className={`onluk-stage onluk-stage-retro mx-auto max-w-[460px] px-3 py-4 sm:px-5 sm:py-5 ${
              boardMiss ? 'onluk-board-miss' : ''
            }`}
          >
            <div className="mb-3 flex justify-center gap-1.5">
              {Array.from({ length: ONLUK_LIVES }).map((_, i) => (
                <Heart
                  key={i}
                  className={`h-5 w-5 ${
                    i < livesLeft ? 'fill-[#c44536] text-[#c44536]' : 'text-[#2a2418]/40'
                  }`}
                  strokeWidth={1.75}
                />
              ))}
            </div>

            <div className="onluk-question mb-3 px-2 text-center">
              <div className="flex items-center justify-center gap-2">
                {crestA && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crestA} alt="" className="h-8 w-8 object-contain drop-shadow" />
                )}
                <p className="text-[15px] font-bold leading-snug text-[#1a140c]">{title}</p>
                {crestB && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crestB} alt="" className="h-8 w-8 object-contain drop-shadow" />
                )}
              </div>
              <p className="mt-1 text-[11px] font-medium text-[#5c4e3a]">{note}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              {slots.slice(0, 5).map((slot, i) => (
                <RankSlot
                  key={`u-${i}`}
                  rank={i + 1}
                  answer={slot}
                  tone={
                    !slot
                      ? 'empty'
                      : gaveUp && !foundIds.includes(slot.playerId)
                        ? 'missed'
                        : 'found'
                  }
                  scanning={scanIndex === i}
                  scanLabel={scanIndex === i ? scanLabel : null}
                  scanPhase={scanIndex === i ? scanPhase : 'idle'}
                />
              ))}

              <div className="onluk-center onluk-center-retro my-1 flex min-h-[50px] flex-col items-center justify-center px-3 py-2 text-center">
                <span className="text-[14px] font-black tracking-[0.18em] text-[#f3e6c8]">
                  ONLUK
                </span>
                <span className="mt-0.5 max-w-[90%] truncate text-[11px] font-semibold text-[#d4c4a0]">
                  {subtitle}
                </span>
              </div>

              {slots.slice(5, 10).map((slot, i) => (
                <RankSlot
                  key={`l-${i}`}
                  rank={i + 6}
                  answer={slot}
                  tone={
                    !slot
                      ? 'empty'
                      : gaveUp && !foundIds.includes(slot.playerId)
                        ? 'missed'
                        : 'found'
                  }
                  scanning={scanIndex === i + 5}
                  scanLabel={scanIndex === i + 5 ? scanLabel : null}
                  scanPhase={scanIndex === i + 5 ? scanPhase : 'idle'}
                />
              ))}
            </div>

            {(status === 'won' || status === 'lost') && (
              <div className="mt-4 rounded-[4px] border border-[#2a2418]/25 bg-[#2a2418]/08 px-3 py-2 text-center text-[12px] font-semibold text-[#3d3224]">
                {status === 'won'
                  ? `${placedCount}/10 tamam`
                  : gaveUp
                    ? `${placedCount}/10 · cevaplar açık`
                    : `${placedCount}/10 · ${unit}`}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RankSlot({
  rank,
  answer,
  tone,
  scanning,
  scanLabel,
  scanPhase,
}: {
  rank: number;
  answer: OnlukAnswer | null;
  tone: 'empty' | 'found' | 'missed';
  scanning: boolean;
  scanLabel: string | null;
  scanPhase: 'idle' | 'hover' | 'hit' | 'miss';
}) {
  const showScanName = scanning && scanLabel && (scanPhase === 'hover' || scanPhase === 'hit');
  const isHit = scanning && scanPhase === 'hit';

  return (
    <div
      className={`onluk-box flex min-h-[42px] items-center gap-2 px-2.5 sm:min-h-[46px] ${
        tone === 'found' ? 'onluk-box-filled' : ''
      } ${tone === 'missed' ? 'onluk-box-missed' : ''} ${
        scanning && scanPhase === 'hover' ? 'onluk-box-scan' : ''
      } ${isHit ? 'onluk-box-hit' : ''}`}
    >
      <span className="onluk-rank w-5 shrink-0 text-center text-[11px] font-black">{rank}</span>
      {answer && !showScanName ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold sm:text-[14px]">
            {answer.name}
          </span>
          <span className="shrink-0 text-[11px] font-semibold opacity-80">{answer.valueLabel}</span>
        </>
      ) : showScanName ? (
        <span
          className={`min-w-0 flex-1 truncate text-[13px] font-bold sm:text-[14px] ${
            isHit ? 'text-[#0f3d1c]' : 'text-[#1a140c]'
          }`}
        >
          {scanLabel}
        </span>
      ) : (
        <span className="flex-1 text-center text-[12px] opacity-30">·</span>
      )}
    </div>
  );
}
