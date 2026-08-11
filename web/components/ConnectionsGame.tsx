'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';
import {
  isGameStartBlocked,
  shouldPersistGameState,
} from '@/lib/daily-access';
import {
  CONNECTIONS_COLORS,
  CONNECTIONS_COLOR_LABELS,
  CONNECTIONS_GROUP_SIZE,
  CONNECTIONS_MISTAKES,
  type ConnectionsColor,
} from '@/lib/connections-shared';
import { type DifficultyId } from '@/lib/difficulty-config';

interface PlayerCard {
  id: number;
  name: string;
  nationality: string;
  position: string;
  clubCrest: string | null;
}

interface PuzzlePublic {
  date: string;
  session: number;
  difficulty: DifficultyId;
  mistakes: number;
  players: PlayerCard[];
  board: number[];
}

interface SolvedGroup {
  id: string;
  label: string;
  traits: string[];
  color: ConnectionsColor;
  playerIds: number[];
  players: Array<{ id: number; name: string }>;
}

interface GuessResult {
  correct: boolean;
  oneAway: boolean;
  mistakesLeft: number;
  solvedGroup: SolvedGroup | null;
  won: boolean;
  lost: boolean;
  remainingGroups?: SolvedGroup[];
}

interface StoredGameState {
  date: string;
  difficulty: DifficultyId;
  session: number;
  board: number[];
  solved: SolvedGroup[];
  mistakesLeft: number;
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
}

const COLOR_STYLES: Record<ConnectionsColor, string> = {
  yellow: 'bg-amber-200 text-amber-950 border-amber-300',
  green: 'bg-emerald-200 text-emerald-950 border-emerald-300',
  blue: 'bg-sky-200 text-sky-950 border-sky-300',
  purple: 'bg-violet-200 text-violet-950 border-violet-300',
};

function storageKey(difficulty: DifficultyId, date: string, session: number): string {
  return `football-connections:v1:${difficulty}:${date}:${session}`;
}

function loadState(
  difficulty: DifficultyId,
  date: string,
  session: number
): StoredGameState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(difficulty, date, session));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGameState;
    if (parsed.date !== date || parsed.difficulty !== difficulty || parsed.session !== session) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveState(state: StoredGameState): void {
  if (!shouldPersistGameState(state.date)) return;
  localStorage.setItem(
    storageKey(state.difficulty, state.date, state.session),
    JSON.stringify(state)
  );
}

function shuffleLocal<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function ConnectionsGame() {
  const shell = useGameShell('connections');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;

  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [session, setSession] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [players, setPlayers] = useState<PlayerCard[]>([]);
  const [board, setBoard] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [solved, setSolved] = useState<SolvedGroup[]>([]);
  const [mistakesLeft, setMistakesLeft] = useState(CONNECTIONS_MISTAKES);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [gaveUp, setGaveUp] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const bootRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const solvedIds = useMemo(() => new Set(solved.flatMap((g) => g.playerIds)), [solved]);
  const remainingBoard = useMemo(
    () => board.filter((id) => !solvedIds.has(id)),
    [board, solvedIds]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const persist = useCallback(
    (partial: Partial<StoredGameState> & Pick<StoredGameState, 'board' | 'solved' | 'mistakesLeft' | 'status'>) => {
      saveState({
        date,
        difficulty,
        session,
        board: partial.board,
        solved: partial.solved,
        mistakesLeft: partial.mistakesLeft,
        status: partial.status,
        gaveUp: partial.gaveUp ?? gaveUp,
      });
    },
    [date, difficulty, session, gaveUp]
  );

  const applyPuzzle = useCallback(
    (puzzle: PuzzlePublic, restored?: StoredGameState | null) => {
      setPlayers(puzzle.players);
      if (restored && restored.board.length === puzzle.board.length) {
        setBoard(restored.board);
        setSolved(restored.solved);
        setMistakesLeft(restored.mistakesLeft);
        setStatus(restored.status);
        setGaveUp(!!restored.gaveUp);
      } else {
        setBoard(puzzle.board);
        setSolved([]);
        setMistakesLeft(puzzle.mistakes);
        setStatus('playing');
        setGaveUp(false);
      }
      setSelected([]);
      setConfirmGiveUp(false);
      setToast(null);
    },
    []
  );

  const loadPuzzle = useCallback(
    async (diff: DifficultyId, sess: number, preferRestore: boolean) => {
      if (isGameStartBlocked('connections', date)) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const restoreOk = preferRestore && shouldPersistGameState(date);
        const restored = restoreOk ? loadState(diff, date, sess) : null;
        const res = await fetch(
          `/api/games/connections/puzzle?difficulty=${diff}&date=${date}&session=${sess}`
        );
        const data = (await res.json()) as PuzzlePublic & { error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Puzzle yüklenemedi');
        applyPuzzle(data, restored);
        if (!restored) {
          saveState({
            date,
            difficulty: diff,
            session: sess,
            board: data.board,
            solved: [],
            mistakesLeft: data.mistakes,
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
  }, [date, difficulty]);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    setSession(0);
    void loadPuzzle(difficulty, 0, true);
  }, [date, difficulty, loadPuzzle]);

  const toggleSelect = (id: number) => {
    if (status !== 'playing' || busy || solvedIds.has(id)) return;
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= CONNECTIONS_GROUP_SIZE) return prev;
      return [...prev, id];
    });
  };

  const handleSubmit = async () => {
    if (status !== 'playing' || busy || selected.length !== CONNECTIONS_GROUP_SIZE) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/games/connections/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          difficulty,
          date,
          session,
          playerIds: selected,
          solvedGroupIds: solved.map((g) => g.id),
          mistakesLeft,
        }),
      });
      const data = (await res.json()) as GuessResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Tahmin başarısız');

      if (data.correct && data.solvedGroup) {
        const nextSolved = [...solved, data.solvedGroup];
        setSolved(nextSolved);
        setSelected([]);
        const nextStatus = data.won ? 'won' : 'playing';
        setStatus(nextStatus);
        persist({
          board,
          solved: nextSolved,
          mistakesLeft: data.mistakesLeft,
          status: nextStatus,
        });
        if (data.won) recordOfficialResult('won');
        showToast('Doğru!');
      } else {
        setMistakesLeft(data.mistakesLeft);
        setShake(true);
        setTimeout(() => setShake(false), 450);
        if (data.oneAway) showToast('Bir eksik!');
        else showToast('Yanlış');

        if (data.lost) {
          const remaining = data.remainingGroups ?? [];
          const nextSolved = [...solved, ...remaining];
          setSolved(nextSolved);
          setSelected([]);
          setStatus('lost');
          persist({
            board,
            solved: nextSolved,
            mistakesLeft: 0,
            status: 'lost',
          });
          recordOfficialResult('lost');
        } else {
          persist({
            board,
            solved,
            mistakesLeft: data.mistakesLeft,
            status: 'playing',
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tahmin başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleShuffle = () => {
    if (status !== 'playing' || busy) return;
    const next = [
      ...board.filter((id) => solvedIds.has(id)),
      ...shuffleLocal(remainingBoard),
    ];
    setBoard(next);
    persist({ board: next, solved, mistakesLeft, status });
  };

  const handleDeselect = () => setSelected([]);

  const handleGiveUp = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/games/connections/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          difficulty,
          date,
          session,
          solvedGroupIds: solved.map((g) => g.id),
        }),
      });
      const data = (await res.json()) as { groups?: SolvedGroup[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Pes etme başarısız');
      const nextSolved = [...solved, ...(data.groups ?? [])];
      setSolved(nextSolved);
      setSelected([]);
      setStatus('lost');
      setGaveUp(true);
      setConfirmGiveUp(false);
      persist({
        board,
        solved: nextSolved,
        mistakesLeft,
        status: 'lost',
        gaveUp: true,
      });
      recordOfficialResult('lost');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pes etme başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleTimerExpire = useCallback(() => {
    if (status !== 'playing' || busy) return;
    setStatus('lost');
    recordOfficialResult('lost');
    void (async () => {
      try {
        const res = await fetch('/api/games/connections/give-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            difficulty,
            date,
            session,
            solvedGroupIds: solved.map((g) => g.id),
          }),
        });
        const data = (await res.json()) as { groups?: SolvedGroup[] };
        if (res.ok && data.groups) {
          const nextSolved = [...solved, ...data.groups];
          setSolved(nextSolved);
          persist({
            board,
            solved: nextSolved,
            mistakesLeft,
            status: 'lost',
            gaveUp: true,
          });
        }
      } catch {
        /* ignore */
      }
    })();
  }, [
    status,
    busy,
    recordOfficialResult,
    difficulty,
    date,
    session,
    solved,
    board,
    mistakesLeft,
    persist,
  ]);

  return (
    <div className="relative mx-auto w-full max-w-[920px]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[280px]">
          <header className="mb-5">
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">Bağlantılar</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              16 oyuncuyu 4 gruba ayır. Her grubun en az iki ortak noktası var — 4 kart seçip
              gönder.
            </p>
          </header>

          <GameSetupPanel
            gameId="connections"
            date={date}
            onDateChange={(d) => {
              setDate(d);
              setSession(0);
            }}
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            timerEnabled={timerEnabled}
            onTimerEnabledChange={setTimerEnabled}
            disabled={busy}
          />

          <div className="mb-4 mt-3">
            <GameTimer
              enabled={timerEnabled}
              limitSec={timerLimitSec}
              running={status === 'playing' && !loading}
              onExpire={handleTimerExpire}
            />
          </div>

          <div className="mb-3 rounded-card border border-line bg-white px-4 py-3">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Hatalar</p>
            <div className="mt-2 flex gap-1.5">
              {Array.from({ length: CONNECTIONS_MISTAKES }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 rounded-full ${
                    i < mistakesLeft ? 'bg-ink' : 'bg-line'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="mb-4 space-y-1.5 text-[12px] text-muted">
            {CONNECTIONS_COLORS.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <span className={`h-3 w-3 rounded-sm border ${COLOR_STYLES[c]}`} />
                <span>{CONNECTIONS_COLOR_LABELS[c]}</span>
              </div>
            ))}
          </div>

          {status === 'playing' && (
            <div className="mb-4">
              {!confirmGiveUp ? (
                <button
                  type="button"
                  onClick={() => setConfirmGiveUp(true)}
                  disabled={busy}
                  className="text-[13px] font-medium text-muted transition hover:text-miss-dark"
                >
                  Pes etme
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGiveUp()}
                    className="rounded-md border border-miss-dark bg-miss-light px-3 py-1.5 text-[12px] font-medium text-miss-dark"
                  >
                    Pes et
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmGiveUp(false)}
                    className="rounded-md border border-line px-3 py-1.5 text-[12px] text-muted"
                  >
                    Vazgeç
                  </button>
                </div>
              )}
            </div>
          )}

          {(status === 'won' || status === 'lost') && (
            <div
              className={`mb-4 rounded-card border px-4 py-3 text-[14px] font-medium ${
                status === 'won'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-miss-dark/30 bg-miss-light text-miss-dark'
              }`}
            >
              {status === 'won'
                ? 'Tebrikler — 4 grubu da buldun!'
                : gaveUp
                  ? 'Pes ettin. Gruplar açıldı.'
                  : 'Oyun bitti. Gruplar açıldı.'}
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {loading && (
            <p className="py-16 text-center text-[14px] text-muted">Bulmaca yükleniyor…</p>
          )}
          {error && (
            <p className="mb-4 rounded-card border border-miss-dark/30 bg-miss-light px-4 py-3 text-[13px] text-miss-dark">
              {error}
            </p>
          )}

          {!loading && !error && (
            <>
              <div className="mb-3 space-y-2">
                {solved.map((g) => (
                  <div
                    key={g.id}
                    className={`rounded-card border px-4 py-3 transition ${COLOR_STYLES[g.color]}`}
                  >
                    <p className="text-[13px] font-semibold uppercase tracking-wide">{g.label}</p>
                    <p className="mt-1 text-[12px] opacity-80">{g.traits.join(' · ')}</p>
                    <p className="mt-2 text-[13px] font-medium">
                      {g.players.map((p) => p.name).join(', ')}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className={`grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5 ${
                  shake ? 'conn-shake' : ''
                }`}
              >
                {remainingBoard.map((id) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  const isSelected = selected.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSelect(id)}
                      disabled={status !== 'playing' || busy}
                      className={`flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-card border px-2 py-3 text-center transition ${
                        isSelected
                          ? 'border-ink bg-ink text-white shadow-sm'
                          : 'border-line bg-white text-ink hover:border-brand hover:bg-brand-light/40'
                      }`}
                    >
                      {p.clubCrest ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.clubCrest}
                          alt=""
                          width={22}
                          height={22}
                          className={`h-[22px] w-[22px] object-contain ${isSelected ? 'brightness-0 invert' : ''}`}
                        />
                      ) : (
                        <span
                          className={`h-[22px] w-[22px] rounded-full ${
                            isSelected ? 'bg-white/30' : 'bg-sidebar'
                          }`}
                        />
                      )}
                      <span className="line-clamp-2 text-[12px] font-semibold leading-tight sm:text-[13px]">
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {status === 'playing' && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={busy || selected.length !== CONNECTIONS_GROUP_SIZE}
                    className="rounded-pill bg-brand px-5 py-2.5 text-[13px] font-semibold text-white transition enabled:hover:bg-brand-dark disabled:opacity-40"
                  >
                    Gönder ({selected.length}/{CONNECTIONS_GROUP_SIZE})
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselect}
                    disabled={busy || selected.length === 0}
                    className="rounded-pill border border-line px-4 py-2.5 text-[13px] font-medium text-muted transition hover:text-ink disabled:opacity-40"
                  >
                    Seçimi temizle
                  </button>
                  <button
                    type="button"
                    onClick={handleShuffle}
                    disabled={busy}
                    className="rounded-pill border border-line px-4 py-2.5 text-[13px] font-medium text-muted transition hover:text-ink disabled:opacity-40"
                  >
                    Karıştır
                  </button>
                </div>
              )}

              {toast && (
                <div className="pointer-events-none fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-pill bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-lg">
                  {toast}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <style>{`
        @keyframes conn-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        .conn-shake { animation: conn-shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
