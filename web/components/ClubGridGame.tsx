'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type DifficultyId } from '@/lib/difficulty-config';
import { isToday, shouldPersistGameState } from '@/lib/daily-access';
import { GRID_SIZE } from '@/lib/club-grid-shared';
import type { PlayerDisplay } from '@/lib/players';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { isGameStartBlocked } from '@/lib/daily-access';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';

interface ClubAxis {
  key: string;
  label: string;
  crest: string | null;
}

interface CellState {
  status: 'open' | 'correct' | 'wrong' | 'revealed';
  player?: PlayerDisplay;
}

interface StoredGameState {
  date: string;
  difficulty: DifficultyId;
  session: number;
  rows: ClubAxis[];
  cols: ClubAxis[];
  cells: Record<string, CellState>;
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
}

interface SearchResult {
  id: number;
  name: string;
  nationality: string;
  position: string;
  club: string;
  clubCrest: string | null;
  age: number | null;
}

function storageKey(difficulty: DifficultyId, date: string, session: number): string {
  return `football-club-grid:v1:${difficulty}:${date}:${session}`;
}

function sessionMetaKey(difficulty: DifficultyId, date: string): string {
  return `football-club-grid:v1:session:${difficulty}:${date}`;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function emptyCells(): Record<string, CellState> {
  const out: Record<string, CellState> = {};
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      out[cellKey(r, c)] = { status: 'open' };
    }
  }
  return out;
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
  localStorage.setItem(sessionMetaKey(state.difficulty, state.date), String(state.session));
}

function getPreferredSession(difficulty: DifficultyId, date: string): number {
  if (typeof window === 'undefined') return 0;
  const meta = localStorage.getItem(sessionMetaKey(difficulty, date));
  if (meta) {
    const parsed = parseInt(meta, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  for (let s = 99; s >= 0; s--) {
    const state = loadState(difficulty, date, s);
    if (state?.status === 'playing') return s;
  }
  return 0;
}

function ClubBadge({ club }: { club: ClubAxis }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-1 text-center">
      {club.crest ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={club.crest} alt="" className="h-10 w-10 object-contain sm:h-12 sm:w-12" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar text-[10px] font-bold text-muted sm:h-12 sm:w-12">
          {club.label.slice(0, 3).toUpperCase()}
        </div>
      )}
      <span className="max-w-[88px] text-[11px] font-semibold leading-tight text-ink sm:max-w-[110px] sm:text-[12px]">
        {club.label}
      </span>
    </div>
  );
}

function SearchModal({
  open,
  rowLabel,
  colLabel,
  onClose,
  onPick,
  usedIds,
  loading,
  error,
}: {
  open: boolean;
  rowLabel: string;
  colLabel: string;
  onClose: () => void;
  onPick: (player: SearchResult) => void;
  usedIds: Set<number>;
  loading: boolean;
  error: string | null;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSuggestions([]);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (searchRef.current) clearTimeout(searchRef.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const seq = ++searchSeq.current;
    searchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(query)}&mode=general`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { players: SearchResult[] };
        if (seq !== searchSeq.current) return;
        setSuggestions(data.players.filter((p) => !usedIds.has(p.id)));
      } catch {
        if (seq !== searchSeq.current) return;
        setSuggestions([]);
      }
    }, 80);
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [query, open, usedIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-md rounded-2xl border border-line bg-page shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-[15px] font-semibold text-ink">Oyuncu seç</p>
            <p className="mt-0.5 text-[13px] text-muted">
              {rowLabel} <span className="text-muted-light">×</span> {colLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-line px-3 py-1 text-[12px] text-muted hover:text-ink"
          >
            Kapat
          </button>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Oyuncu adı yazın..."
            disabled={loading}
            className="w-full rounded-md border border-line bg-page px-3.5 py-2.5 text-[14px] text-ink placeholder:text-muted-light focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
          />
          {error && <p className="mt-2 text-[12px] text-miss-dark">{error}</p>}
          {suggestions.length > 0 && (
            <ul className="mt-3 max-h-64 overflow-y-auto rounded-md border border-line">
              {suggestions.map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onPick(player)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] hover:bg-sidebar disabled:opacity-40"
                  >
                    {player.clubCrest ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={player.clubCrest}
                        alt=""
                        className="h-8 w-8 rounded-full bg-sidebar object-contain"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-sidebar" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{player.name}</p>
                      <p className="truncate text-[12px] text-muted">
                        {player.club} · {player.nationality}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && suggestions.length === 0 && (
            <p className="mt-3 text-[12px] text-muted-light">Sonuç yok</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClubGridGame() {
  const shell = useGameShell('club-grid');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [session, setSession] = useState(0);
  const [rows, setRows] = useState<ClubAxis[]>([]);
  const [cols, setCols] = useState<ClubAxis[]>([]);
  const [cells, setCells] = useState<Record<string, CellState>>(emptyCells);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [loadingPuzzle, setLoadingPuzzle] = useState(true);
  const [guessLoading, setGuessLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  const solvedCount = useMemo(
    () => Object.values(cells).filter((c) => c.status === 'correct').length,
    [cells]
  );

  const usedIds = useMemo(() => {
    const set = new Set<number>();
    for (const cell of Object.values(cells)) {
      if (cell.player) set.add(cell.player.id);
    }
    return set;
  }, [cells]);

  const fetchPuzzle = useCallback(
    async (nextDifficulty: DifficultyId, nextSession: number) => {
      const res = await fetch(
        `/api/games/club-grid/puzzle?mode=general&difficulty=${nextDifficulty}&date=${date}&session=${nextSession}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Bulmaca yüklenemedi');
      return data as { rows: ClubAxis[]; cols: ClubAxis[] };
    },
    [date]
  );

  const restore = useCallback(
    async (nextDifficulty: DifficultyId) => {
      if (isGameStartBlocked('club-grid', date)) {
        setLoadingPuzzle(false);
        return;
      }
      const preferred = shouldPersistGameState(date) ? getPreferredSession(nextDifficulty, date) : 0;
      const saved =
        shouldPersistGameState(date) ? loadState(nextDifficulty, date, preferred) : null;
      setSession(0);
      setLoadingPuzzle(true);
      setError(null);
      setConfirmGiveUp(false);
      setActiveCell(null);
      setModalError(null);

      try {
        if (saved?.rows?.length === GRID_SIZE && saved.cols?.length === GRID_SIZE) {
          setRows(saved.rows);
          setCols(saved.cols);
          setCells(saved.cells);
          setStatus(saved.status);
          setGaveUp(saved.gaveUp ?? false);
        } else {
          const puzzle = await fetchPuzzle(nextDifficulty, preferred);
          const nextCells = emptyCells();
          setRows(puzzle.rows);
          setCols(puzzle.cols);
          setCells(nextCells);
          setStatus('playing');
          setGaveUp(false);
          saveState({
            date,
            difficulty: nextDifficulty,
            session: 0,
            rows: puzzle.rows,
            cols: puzzle.cols,
            cells: nextCells,
            status: 'playing',
          });
        }
      } catch (err) {
        setRows([]);
        setCols([]);
        setError(err instanceof Error ? err.message : 'Bulmaca yüklenemedi');
      } finally {
        setLoadingPuzzle(false);
      }
    },
    [date, fetchPuzzle]
  );

  useEffect(() => {
    void restore(difficulty);
  }, [difficulty, date, restore]);

  async function handlePick(player: SearchResult) {
    if (!activeCell || status !== 'playing' || guessLoading) return;
    const { row, col } = activeCell;
    const key = cellKey(row, col);
    if (cells[key]?.status !== 'open') return;

    setGuessLoading(true);
    setModalError(null);

    try {
      const openCells = Object.entries(cells)
        .filter(([, c]) => c.status === 'open')
        .map(([k]) => {
          const [r, c] = k.split(':').map(Number);
          return { row: r, col: c };
        });

      const res = await fetch('/api/games/club-grid/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'general',
          difficulty,
          date,
          session,
          row,
          col,
          playerId: player.id,
          usedPlayerIds: [...usedIds],
          solvedCount,
          openCells,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error ?? 'Tahmin gönderilemedi');
        return;
      }

      const nextCells = { ...cells };
      if (data.correct && Array.isArray(data.extraFills) && data.extraFills.length > 0) {
        for (const fill of data.extraFills as Array<{ row: number; col: number; cellKey: string }>) {
          nextCells[fill.cellKey] = {
            status: 'correct' as const,
            player: data.guess as PlayerDisplay,
          };
        }
      } else {
        nextCells[key] = {
          status: data.correct ? ('correct' as const) : ('wrong' as const),
          player: data.guess as PlayerDisplay,
        };
      }
      const nextSolved = Object.values(nextCells).filter((c) => c.status === 'correct').length;
      const openLeft = Object.values(nextCells).filter((c) => c.status === 'open').length;
      const nextStatus: StoredGameState['status'] =
        nextSolved === GRID_SIZE * GRID_SIZE
          ? 'won'
          : openLeft === 0
            ? 'lost'
            : 'playing';

      setCells(nextCells);
      setStatus(nextStatus);
      setActiveCell(null);
      if (nextStatus === 'won') recordOfficialResult('won');
      if (nextStatus === 'lost') recordOfficialResult('lost');
      saveState({
        date: date,
        difficulty,
        session,
        rows,
        cols,
        cells: nextCells,
        status: nextStatus,
      });
    } catch {
      setModalError('Bağlantı hatası. Tekrar deneyin.');
    } finally {
      setGuessLoading(false);
    }
  }

  async function handleGiveUp() {
    if (status !== 'playing' || guessLoading) return;
    setGuessLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/games/club-grid/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'general',
          difficulty,
          date,
          session,
          usedPlayerIds: [...usedIds],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Pes etme başarısız');
        return;
      }

      const nextCells = { ...cells };
      for (const ans of data.answers as Array<{ row: number; col: number; player: PlayerDisplay }>) {
        const key = cellKey(ans.row, ans.col);
        const prev = nextCells[key];
        if (prev?.status === 'correct') continue;
        nextCells[key] = { status: 'revealed', player: ans.player };
      }

      setCells(nextCells);
      setStatus('lost');
      setGaveUp(true);
      setConfirmGiveUp(false);
      setActiveCell(null);
      recordOfficialResult('lost');
      saveState({
        date,
        difficulty,
        session,
        rows,
        cols,
        cells: nextCells,
        status: 'lost',
        gaveUp: true,
      });
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
    } finally {
      setGuessLoading(false);
    }
  }

  async function handlePlayAgain() {
    setSession(0);
    setLoadingPuzzle(true);
    setActiveCell(null);
    setConfirmGiveUp(false);
    setError(null);
    try {
      const puzzle = await fetchPuzzle(difficulty, 0);
      const nextCells = emptyCells();
      setRows(puzzle.rows);
      setCols(puzzle.cols);
      setCells(nextCells);
      setStatus('playing');
      setGaveUp(false);
      if (shouldPersistGameState(date)) {
        saveState({
          date,
          difficulty,
          session: 0,
          rows: puzzle.rows,
          cols: puzzle.cols,
          cells: nextCells,
          status: 'playing',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulmaca yüklenemedi');
    } finally {
      setLoadingPuzzle(false);
    }
  }

  const activeRowLabel =
    activeCell && rows[activeCell.row] ? rows[activeCell.row].label : '';
  const activeColLabel =
    activeCell && cols[activeCell.col] ? cols[activeCell.col].label : '';

  return (
    <div className="relative mx-auto w-full max-w-[1100px]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[280px]">
          <header className="mb-5">
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">Kulüp Grid</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              Her hücre hem satır hem sütun kulübünde oynamış bir oyuncu olsun. Aynı oyuncuyu iki
              kez kullanamazsın.
            </p>
          </header>

          <GameSetupPanel
            gameId="club-grid"
            date={date}
            onDateChange={(d) => {
              setDate(d);
              setSession(0);
            }}
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            timerEnabled={timerEnabled}
            onTimerEnabledChange={setTimerEnabled}
            disabled={guessLoading}
          />

          <div className="mb-4 mt-3">
            <GameTimer
              enabled={timerEnabled}
              limitSec={timerLimitSec}
              running={status === 'playing' && !loadingPuzzle}
              onExpire={() => {
                if (status === 'playing') {
                  setStatus('lost');
                  recordOfficialResult('lost');
                }
              }}
            />
          </div>

          <div className="mb-4 flex items-center justify-between rounded-card border border-brand-border/50 bg-brand-light/60 px-4 py-3">
            <p className="text-[14px] font-semibold text-brand-dark">
              {solvedCount}
              <span className="font-medium text-muted"> / {GRID_SIZE * GRID_SIZE}</span>
            </p>
            {status === 'playing' && (
              <div>
                {!confirmGiveUp ? (
                  <button
                    type="button"
                    onClick={() => setConfirmGiveUp(true)}
                    disabled={guessLoading}
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
          </div>

          {error && <p className="mb-3 text-[12px] text-miss-dark">{error}</p>}

          {status !== 'playing' && (
            <div
              className={`rounded-card border p-4 ${
                status === 'won'
                  ? 'border-brand-border bg-brand-light'
                  : 'border-miss-light bg-miss-light/50'
              }`}
            >
              <p className="text-[14px] font-medium text-ink">
                {status === 'won'
                  ? 'Tebrikler! Grid tamam.'
                  : gaveUp
                    ? 'Pes ettiniz — örnek cevaplar açıldı.'
                    : 'Grid bitti.'}
              </p>
              <button
                type="button"
                onClick={() => void handlePlayAgain()}
                className="mt-3 rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-dark"
              >
                {isToday(date) ? 'Kapat' : 'Yeniden dene'}
              </button>
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1">
          {loadingPuzzle ? (
            <p className="text-[13px] text-muted">Grid yükleniyor…</p>
          ) : rows.length === GRID_SIZE && cols.length === GRID_SIZE ? (
            <div className="overflow-x-auto">
              <div
                className="inline-grid gap-2 sm:gap-3"
                style={{
                  gridTemplateColumns: `minmax(88px,110px) repeat(${GRID_SIZE}, minmax(100px, 140px))`,
                }}
              >
                <div />
                {cols.map((club) => (
                  <ClubBadge key={club.key} club={club} />
                ))}

                {rows.map((rowClub, r) => (
                  <div key={rowClub.key} className="contents">
                    <ClubBadge club={rowClub} />
                    {cols.map((colClub, c) => {
                      const key = cellKey(r, c);
                      const cell = cells[key] ?? { status: 'open' as const };
                      const clickable = status === 'playing' && cell.status === 'open';
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!clickable}
                          onClick={() => {
                            setModalError(null);
                            setActiveCell({ row: r, col: c });
                          }}
                          className={`flex min-h-[100px] flex-col items-center justify-center rounded-card border px-2 py-3 text-center transition sm:min-h-[120px] ${
                            cell.status === 'correct'
                              ? 'border-brand-border bg-brand-light'
                              : cell.status === 'wrong'
                                ? 'border-miss-light bg-miss-light/50'
                                : cell.status === 'revealed'
                                  ? 'border-line bg-sidebar'
                                  : clickable
                                    ? 'border-line bg-page hover:border-brand hover:bg-brand-light/40'
                                    : 'border-line bg-page'
                          }`}
                        >
                          {cell.player ? (
                            <>
                              <p className="text-[13px] font-semibold leading-tight text-ink sm:text-[14px]">
                                {cell.player.name}
                              </p>
                              <p className="mt-1 text-[11px] text-muted">{cell.player.nationality}</p>
                            </>
                          ) : (
                            <span className="text-[22px] font-light text-muted-light">+</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-miss-dark">Grid yüklenemedi</p>
          )}
        </section>
      </div>

      <SearchModal
        open={activeCell !== null}
        rowLabel={activeRowLabel}
        colLabel={activeColLabel}
        onClose={() => setActiveCell(null)}
        onPick={(p) => void handlePick(p)}
        usedIds={usedIds}
        loading={guessLoading}
        error={modalError}
      />
    </div>
  );
}
