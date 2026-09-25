'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';

import { type DifficultyId } from '@/lib/difficulty-config';
import { shouldPersistGameState } from '@/lib/daily-access';
import { GAME_MODES, MAX_GUESSES, type GameModeId } from '@/lib/game-modes';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTitle } from '@/components/GameHelpButton';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';
import type { PlayerDisplay } from '@/lib/players';

interface ClubStop {
  teamId: number | null;
  name: string;
  crest: string | null;
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

interface StoredGameState {
  date: string;
  mode: GameModeId;
  difficulty: DifficultyId;
  session: number;
  guesses: PlayerDisplay[];
  clubs: ClubStop[];
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
  revealed?: PlayerDisplay;
}

function storageKey(
  mode: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): string {
  return `football-career-path:${mode}:${difficulty}:${date}:${session}`;
}

function sessionMetaKey(mode: GameModeId, difficulty: DifficultyId, date: string): string {
  return `football-career-path:session:${mode}:${difficulty}:${date}`;
}

function loadState(
  mode: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): StoredGameState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(mode, difficulty, date, session));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGameState;
    if (
      parsed.date !== date ||
      parsed.mode !== mode ||
      parsed.difficulty !== difficulty ||
      parsed.session !== session
    ) {
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
    storageKey(state.mode, state.difficulty, state.date, state.session),
    JSON.stringify(state)
  );
  localStorage.setItem(
    sessionMetaKey(state.mode, state.difficulty, state.date),
    String(state.session)
  );
}

function getPreferredSession(
  mode: GameModeId,
  difficulty: DifficultyId,
  date: string
): number {
  if (typeof window === 'undefined') return 0;

  const meta = localStorage.getItem(sessionMetaKey(mode, difficulty, date));
  if (meta) {
    const parsed = parseInt(meta, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }

  for (let s = 99; s >= 0; s--) {
    const state = loadState(mode, difficulty, date, s);
    if (state?.status === 'playing') return s;
  }

  return 0;
}

function abbreviateClub(club: string): string {
  if (club === 'Bilinmiyor') return '?';
  const cleaned = club
    .replace(/\b(FC|CF|CFC|SK|AC|AS|SC|AFC|S\.K\.)\b/gi, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
  }
  return cleaned.slice(0, 4).toUpperCase();
}

function abbreviatePosition(position: string): string {
  if (position === 'Bilinmiyor') return '?';
  const map: Record<string, string> = {
    Goalkeeper: 'KL',
    Defence: 'DF',
    Defender: 'DF',
    Midfield: 'OS',
    Offence: 'FW',
    Forward: 'FW',
  };
  return map[position] ?? position.slice(0, 3).toUpperCase();
}

function ClubTrail({ clubs }: { clubs: ClubStop[] }) {
  return (
    <div className="rounded-card border border-line bg-page px-3 py-4 sm:px-4">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-light">
        Kariyer rotası · {clubs.length} kulüp
      </p>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {clubs.map((club, index) => (
          <div key={`${club.teamId ?? club.name}-${index}`} className="flex items-center gap-2 sm:gap-3">
            <div className="flex w-[72px] flex-col items-center gap-1.5 sm:w-[80px]">
              {club.crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={club.crest}
                  alt={club.name}
                  title={club.name}
                  className="h-12 w-12 rounded-full bg-sidebar object-contain sm:h-14 sm:w-14"
                />
              ) : (
                <div
                  title={club.name}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-sidebar text-[11px] font-semibold text-muted sm:h-14 sm:w-14"
                >
                  {abbreviateClub(club.name)}
                </div>
              )}
              <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-ink">
                {club.name}
              </span>
            </div>
            {index < clubs.length - 1 && (
              <ArrowRight className="mb-5 h-4 w-4 shrink-0 text-muted-light" strokeWidth={2} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CareerPathGame() {
  const shell = useGameShell('career-path');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [mode, setMode] = useState<GameModeId>('general');
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [session, setSession] = useState(0);
  const [clubs, setClubs] = useState<ClubStop[]>([]);
  const [puzzleLoading, setPuzzleLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [guesses, setGuesses] = useState<PlayerDisplay[]>([]);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [revealed, setRevealed] = useState<PlayerDisplay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const gameOver = status !== 'playing';
  const attemptsLeft = MAX_GUESSES - guesses.length;

  const fetchPuzzle = useCallback(
    async (
      nextMode: GameModeId,
      nextDifficulty: DifficultyId,
      nextSession: number
    ): Promise<ClubStop[] | null> => {
      const res = await fetch(
        `/api/games/career-path/puzzle?mode=${nextMode}&difficulty=${nextDifficulty}&date=${date}&session=${nextSession}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Bulmaca yüklenemedi');
      }
      return data.clubs as ClubStop[];
    },
    [date]
  );

  const restoreForSettings = useCallback(
    async (nextMode: GameModeId, nextDifficulty: DifficultyId) => {
      const preferredSession = getPreferredSession(nextMode, nextDifficulty, date);
      const saved = loadState(nextMode, nextDifficulty, date, preferredSession);

      setSession(preferredSession);
      setPuzzleLoading(true);
      setError(null);
      setConfirmGiveUp(false);
      setQuery('');
      setSelected(null);
      setSuggestions([]);

      try {
        if (saved?.clubs?.length) {
          setClubs(saved.clubs);
          setGuesses(saved.guesses);
          setStatus(saved.status);
          setRevealed(saved.revealed ?? null);
          setGaveUp(saved.gaveUp ?? false);
        } else {
          const nextClubs = await fetchPuzzle(nextMode, nextDifficulty, preferredSession);
          setClubs(nextClubs ?? []);
          setGuesses([]);
          setStatus('playing');
          setRevealed(null);
          setGaveUp(false);

          if (nextClubs) {
            saveState({
              date: date,
              mode: nextMode,
              difficulty: nextDifficulty,
              session: preferredSession,
              guesses: [],
              clubs: nextClubs,
              status: 'playing',
            });
          }
        }
      } catch (err) {
        setClubs([]);
        setError(err instanceof Error ? err.message : 'Bulmaca yüklenemedi');
      } finally {
        setPuzzleLoading(false);
      }
    },
    [date, fetchPuzzle]
  );

  useEffect(() => {
    void restoreForSettings(mode, difficulty);
  }, [mode, difficulty, date, restoreForSettings]);

  useEffect(() => {
    if (gameOver) return;

    if (searchRef.current) clearTimeout(searchRef.current);

    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    searchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/players/search?q=${encodeURIComponent(query)}&mode=${mode}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { players: SearchResult[] };
        setSuggestions(data.players);
        setDropdownOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, [query, mode, gameOver]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleGuess() {
    if (!selected || gameOver || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/career-path/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: selected.id,
          mode,
          difficulty,
          date: date,
          session,
          attemptNumber: guesses.length + 1,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Tahmin gönderilemedi');
        return;
      }

      const nextGuesses = [...guesses, data.guess as PlayerDisplay];
      const nextStatus: StoredGameState['status'] = data.won
        ? 'won'
        : data.gameOver
          ? 'lost'
          : 'playing';
      const nextClubs = (data.path?.clubs as ClubStop[] | undefined) ?? clubs;

      setGuesses(nextGuesses);
      setStatus(nextStatus);
      if (nextStatus === 'won') recordOfficialResult('won');
      if (nextStatus === 'lost') recordOfficialResult('lost');
      setRevealed(data.revealed ?? null);
      if (data.path?.clubs) setClubs(data.path.clubs);
      setQuery('');
      setSelected(null);
      setSuggestions([]);
      setDropdownOpen(false);

      saveState({
        date: date,
        mode,
        difficulty,
        session,
        guesses: nextGuesses,
        clubs: nextClubs,
        status: nextStatus,
        gaveUp: false,
        revealed: data.revealed,
      });
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }

  function selectPlayer(player: SearchResult) {
    setSelected(player);
    setQuery(player.name);
    setDropdownOpen(false);
  }

  async function handleGiveUp() {
    if (gameOver || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/career-path/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, difficulty, date: date, session }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Pes etme işlemi başarısız');
        return;
      }

      const nextClubs = (data.path?.clubs as ClubStop[] | undefined) ?? clubs;

      setStatus('lost');
      setGaveUp(true);
      recordOfficialResult('lost');
      setRevealed(data.revealed ?? null);
      if (data.path?.clubs) setClubs(data.path.clubs);
      setConfirmGiveUp(false);
      setQuery('');
      setSelected(null);
      setSuggestions([]);
      setDropdownOpen(false);

      saveState({
        date: date,
        mode,
        difficulty,
        session,
        guesses,
        clubs: nextClubs,
        status: 'lost',
        gaveUp: true,
        revealed: data.revealed,
      });
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-xl">
      <header className="relative mb-8">
        <GameTitle gameId="career-path" className="text-[20px] font-medium text-ink" size="sm">
          Kariyer rotası
        </GameTitle>
        <p className="mt-1 text-[13px] text-muted">
          Kulüp yolunu gör, oyuncuyu {MAX_GUESSES} denemede bul.
        </p>
      </header>

      <GameSetupPanel
        gameId="career-path"
        date={date}
        onDateChange={setDate}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        timerEnabled={timerEnabled}
        onTimerEnabledChange={setTimerEnabled}
        disabled={loading || puzzleLoading}
      />

      <div className="relative mb-4 mt-3">
        <GameTimer
          enabled={timerEnabled}
          limitSec={timerLimitSec}
          running={status === 'playing' && !puzzleLoading}
          onExpire={() => {
            if (status === 'playing') {
              setStatus('lost');
              recordOfficialResult('lost');
            }
          }}
        />
      </div>

      <div className="relative mb-4 flex flex-wrap gap-2">
        {GAME_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition ${
              mode === m.id
                ? 'bg-brand text-white'
                : 'border border-line bg-page text-muted hover:border-muted-light'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {puzzleLoading ? (
        <p className="mb-8 text-[13px] text-muted">Rota yükleniyor…</p>
      ) : clubs.length > 0 ? (
        <div className="mb-8">
          <ClubTrail clubs={clubs} />
        </div>
      ) : null}

      {!gameOver && !puzzleLoading && clubs.length > 0 && (
        <div ref={containerRef} className="relative mb-8">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              onFocus={() => suggestions.length > 0 && setDropdownOpen(true)}
              placeholder="Oyuncu adı yazın..."
              className="flex-1 rounded-md border border-line bg-page px-3.5 py-2.5 text-[13px] text-ink placeholder:text-muted-light focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
            />
            <button
              type="button"
              onClick={handleGuess}
              disabled={!selected || loading}
              className="rounded-md bg-brand px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? '...' : 'Tahmin et'}
            </button>
          </div>

          {dropdownOpen && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-page shadow-lg">
              {suggestions.map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    onClick={() => selectPlayer(player)}
                    className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] text-ink hover:bg-sidebar"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {player.clubCrest ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={player.clubCrest}
                          alt={player.club}
                          className="h-8 w-8 shrink-0 rounded-full bg-sidebar object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-[11px] font-semibold text-muted-light">
                          {abbreviateClub(player.club)}
                        </div>
                      )}
                      <span className="truncate font-semibold">{player.name}</span>
                    </div>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar text-[12px] font-semibold text-ink">
                      {abbreviatePosition(player.position)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[12px] text-muted-light">
            Kalan deneme: {attemptsLeft} / {MAX_GUESSES}
          </p>

          <div className="mt-3">
            {!confirmGiveUp ? (
              <button
                type="button"
                onClick={() => setConfirmGiveUp(true)}
                disabled={loading}
                className="text-[13px] font-medium text-muted transition hover:text-miss-dark disabled:opacity-40"
              >
                Pes etme
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleGiveUp}
                  disabled={loading}
                  className="rounded-md border border-miss-dark bg-miss-light px-4 py-2 text-[13px] font-medium text-miss-dark transition hover:bg-miss-light/80 disabled:opacity-40"
                >
                  {loading ? '...' : 'Pes et'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmGiveUp(false)}
                  disabled={loading}
                  className="rounded-md border border-line bg-page px-4 py-2 text-[13px] font-medium text-muted transition hover:border-muted-light disabled:opacity-40"
                >
                  Vazgeç
                </button>
              </div>
            )}
          </div>

          {error && <p className="mt-2 text-[12px] text-miss-dark">{error}</p>}
        </div>
      )}

      {error && (gameOver || puzzleLoading || clubs.length === 0) && (
        <p className="mb-6 text-[12px] text-miss-dark">{error}</p>
      )}

      {gameOver && revealed && (
        <div
          className={`relative mb-8 rounded-card border p-4 ${
            status === 'won'
              ? 'border-brand-border bg-brand-light'
              : 'border-miss-light bg-miss-light/50'
          }`}
        >
          <p className="text-[14px] font-medium text-ink">
            {status === 'won'
              ? `Tebrikler! ${guesses.length}. denemede bildiniz.`
              : gaveUp
                ? 'Pes ettiniz.'
                : 'Deneme hakkınız bitti.'}
          </p>
          <p className="mt-1.5 text-[13px] text-muted">
            Oyuncu:{' '}
            <strong className="font-medium text-ink">{revealed.name}</strong>
            {' — '}
            {revealed.nationality}, {revealed.position}, {revealed.club}
            {revealed.age !== null ? `, ${revealed.age} yaş` : ''}
          </p>
        </div>
      )}

      {guesses.length > 0 && (
        <div className="relative space-y-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-light">
            Tahminler
          </p>
          {guesses.map((guess, index) => {
            const isWin = status === 'won' && index === guesses.length - 1;
            return (
              <div
                key={`${guess.id}-${index}`}
                className={`flex items-center justify-between rounded-card px-3 py-2.5 ${
                  isWin
                    ? 'border-[1.5px] border-brand-border bg-brand-light'
                    : 'border border-line'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {guess.clubCrest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={guess.clubCrest}
                      alt={guess.club}
                      className="h-8 w-8 shrink-0 rounded-full bg-sidebar object-contain"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-[11px] font-semibold text-muted-light">
                      {abbreviateClub(guess.club)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{guess.name}</p>
                    <p className="truncate text-[12px] text-muted">
                      {guess.club} · {guess.nationality}
                    </p>
                  </div>
                </div>
                {isWin ? (
                  <Check className="h-5 w-5 shrink-0 text-brand-dark" strokeWidth={2.5} />
                ) : (
                  <X className="h-5 w-5 shrink-0 text-miss-dark" strokeWidth={2.5} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
