'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
} from 'lucide-react';

import { shouldPersistGameState } from '@/lib/daily-access';
import { type DifficultyId } from '@/lib/difficulty-config';
import { GAME_MODES, MAX_GUESSES, type GameModeId } from '@/lib/game-modes';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';
import type {
  AgeCompareStatus,
  ComparisonResult,
  MatchStatus,
  PlayerDisplay,
} from '@/lib/players';

interface SearchResult {
  id: number;
  name: string;
  nationality: string;
  position: string;
  club: string;
  clubCrest: string | null;
  age: number | null;
}

interface StoredGuess {
  guess: PlayerDisplay;
  comparison: ComparisonResult;
}

interface StoredGameState {
  date: string;
  mode: GameModeId;
  difficulty: DifficultyId;
  session: number;
  guesses: StoredGuess[];
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
  revealed?: PlayerDisplay;
}

type BadgeCategory = 'nationality' | 'position' | 'club' | 'age';

function storageKey(
  mode: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): string {
  return `football-daily-player:${mode}:${difficulty}:${date}:${session}`;
}

function sessionMetaKey(mode: GameModeId, difficulty: DifficultyId, date: string): string {
  return `football-daily-player:session:${mode}:${difficulty}:${date}`;
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

function resetGameState(): Omit<StoredGameState, 'date' | 'mode' | 'difficulty' | 'session'> {
  return {
    guesses: [],
    status: 'playing',
    gaveUp: false,
    revealed: undefined,
  };
}

function categoryLabel(category: BadgeCategory): string {
  switch (category) {
    case 'nationality':
      return 'Milliyet';
    case 'position':
      return 'Mevki';
    case 'club':
      return 'Kulüp';
    case 'age':
      return 'Yaş';
  }
}

function badgeTitle(
  category: BadgeCategory,
  status: MatchStatus | AgeCompareStatus,
  detail?: string
): string {
  const label = categoryLabel(category);
  if (status === 'match') return `${label}: eşleşti`;
  if (status === 'miss') return `${label}: eşleşmedi${detail ? ` (${detail})` : ''}`;
  if (status === 'older') return `${label}: hedef daha yaşlı`;
  if (status === 'younger') return `${label}: hedef daha genç`;
  return `${label}: bilinmiyor`;
}

function categoryShortLabel(category: BadgeCategory): string {
  switch (category) {
    case 'nationality':
      return 'MİL';
    case 'position':
      return 'MEVKİ';
    case 'club':
      return 'KULÜP';
    case 'age':
      return 'YAŞ';
  }
}

function abbreviateNationality(nationality: string): string {
  if (nationality === 'Bilinmiyor') return '?';
  const known: Record<string, string> = {
    Argentina: 'ARG',
    Brazil: 'BRA',
    France: 'FRA',
    Germany: 'GER',
    Spain: 'ESP',
    Italy: 'ITA',
    England: 'ENG',
    Portugal: 'POR',
    Netherlands: 'NED',
    Belgium: 'BEL',
    Croatia: 'CRO',
    Nigeria: 'NGA',
    Turkey: 'TUR',
    'United States': 'USA',
    Uruguay: 'URU',
    Poland: 'POL',
    Morocco: 'MAR',
    Senegal: 'SEN',
    Colombia: 'COL',
    Mexico: 'MEX',
    Japan: 'JPN',
    'South Korea': 'KOR',
    Algeria: 'ALG',
  };
  return known[nationality] ?? nationality.slice(0, 3).toUpperCase();
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
    'Centre-Forward': 'SF',
    'Center-Forward': 'SF',
    'Right Winger': 'SĞK',
    'Left Winger': 'SLK',
    'Right-Back': 'SĞB',
    'Left-Back': 'SLB',
    'Central Midfield': 'MO',
    'Defensive Midfield': 'DOS',
    'Attacking Midfield': 'OOS',
  };
  if (map[position]) return map[position];
  const words = position.split(/\s+/);
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
  return position.slice(0, 3).toUpperCase();
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

function badgeValue(
  category: BadgeCategory,
  guess: PlayerDisplay,
  isWinningRow: boolean
): string {
  if (isWinningRow) return '✓';

  switch (category) {
    case 'nationality':
      return abbreviateNationality(guess.nationality);
    case 'position':
      return abbreviatePosition(guess.position);
    case 'club':
      return abbreviateClub(guess.club);
    case 'age':
      return guess.age !== null ? String(guess.age) : '?';
  }
}

function badgeStyles(
  category: BadgeCategory,
  status: MatchStatus | AgeCompareStatus,
  isWinningRow: boolean
): { bg: string; text: string; showAgeArrow: AgeCompareStatus | null } {
  if (isWinningRow) {
    return { bg: 'bg-brand-border', text: 'text-brand-darker', showAgeArrow: null };
  }

  if (category === 'age') {
    if (status === 'match') {
      return { bg: 'bg-brand-light', text: 'text-brand-dark', showAgeArrow: null };
    }
    if (status === 'older' || status === 'younger') {
      return { bg: 'bg-hint-light', text: 'text-hint-dark', showAgeArrow: status };
    }
    return { bg: 'bg-sidebar', text: 'text-muted-light', showAgeArrow: null };
  }

  if (status === 'match') {
    return { bg: 'bg-brand-light', text: 'text-brand-dark', showAgeArrow: null };
  }

  return { bg: 'bg-miss-light', text: 'text-miss-dark', showAgeArrow: null };
}

function ComparisonBadge({
  category,
  status,
  isWinningRow,
  guess,
}: {
  category: BadgeCategory;
  status: MatchStatus | AgeCompareStatus;
  isWinningRow: boolean;
  guess: PlayerDisplay;
}) {
  const { bg, text, showAgeArrow } = badgeStyles(category, status, isWinningRow);
  const value = badgeValue(category, guess, isWinningRow);

  const detail =
    category === 'nationality'
      ? guess.nationality
      : category === 'position'
        ? guess.position
        : category === 'club'
          ? guess.club
          : guess.age !== null
            ? String(guess.age)
            : undefined;

  return (
    <div className="flex w-[72px] flex-col items-center gap-1">
      <div
        title={badgeTitle(category, status, detail)}
        className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full ${bg} ${text}`}
      >
        {isWinningRow ? (
          <Check className="h-5 w-5" strokeWidth={2.5} />
        ) : (
          <>
            <span className="text-[11px] font-bold leading-none">{value}</span>
            {category === 'age' && showAgeArrow === 'older' && (
              <ArrowUp className="mt-0.5 h-3 w-3" strokeWidth={2.5} />
            )}
            {category === 'age' && showAgeArrow === 'younger' && (
              <ArrowDown className="mt-0.5 h-3 w-3" strokeWidth={2.5} />
            )}
          </>
        )}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
        {categoryShortLabel(category)}
      </span>
    </div>
  );
}

function PitchDecoration() {
  return (
    <svg
      className="pointer-events-none absolute -right-4 top-0 opacity-50"
      width="180"
      height="180"
      viewBox="0 0 180 180"
      fill="none"
      aria-hidden
    >
      <circle cx="90" cy="90" r="90" stroke="#EAF3DE" strokeWidth="1.5" />
      <circle cx="90" cy="90" r="3" fill="#EAF3DE" />
      <line x1="90" y1="0" x2="90" y2="180" stroke="#EAF3DE" strokeWidth="1.5" />
    </svg>
  );
}

function GuessRow({ item, isWinningRow }: { item: StoredGuess; isWinningRow: boolean }) {
  const { guess, comparison } = item;

  return (
    <div
      className={`rounded-card px-3 py-3 ${
        isWinningRow ? 'border-[1.5px] border-brand-border bg-brand-light' : 'border border-line'
      }`}
    >
      <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink">
        {guess.name}
      </p>
      <div className="flex justify-center gap-2 sm:gap-3">
        <ComparisonBadge
          category="nationality"
          status={comparison.nationality}
          isWinningRow={isWinningRow}
          guess={guess}
        />
        <ComparisonBadge
          category="club"
          status={comparison.club}
          isWinningRow={isWinningRow}
          guess={guess}
        />
        <ComparisonBadge
          category="position"
          status={comparison.position}
          isWinningRow={isWinningRow}
          guess={guess}
        />
        <ComparisonBadge
          category="age"
          status={comparison.age}
          isWinningRow={isWinningRow}
          guess={guess}
        />
      </div>
    </div>
  );
}

export function DailyPlayerGame() {
  const shell = useGameShell('daily-player');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [mode, setMode] = useState<GameModeId>('general');
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [session, setSession] = useState(0);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [guesses, setGuesses] = useState<StoredGuess[]>([]);
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

  const restoreForSettings = useCallback(
    (nextMode: GameModeId, nextDifficulty: DifficultyId) => {
      const preferredSession = getPreferredSession(nextMode, nextDifficulty, date);
      const saved = loadState(nextMode, nextDifficulty, date, preferredSession);

      setSession(preferredSession);

      if (saved) {
        setGuesses(saved.guesses);
        setStatus(saved.status);
        setRevealed(saved.revealed ?? null);
        setGaveUp(saved.gaveUp ?? false);
      } else {
        setGuesses([]);
        setStatus('playing');
        setRevealed(null);
        setGaveUp(false);
      }

      setQuery('');
      setSelected(null);
      setSuggestions([]);
      setError(null);
      setConfirmGiveUp(false);
    },
    [date]
  );

  useEffect(() => {
    restoreForSettings(mode, difficulty);
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
    if (!selected || gameOver) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/guess', {
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

      const nextGuess: StoredGuess = {
        guess: data.guess,
        comparison: data.comparison,
      };

      const nextGuesses = [...guesses, nextGuess];
      const nextStatus: StoredGameState['status'] = data.won
        ? 'won'
        : data.gameOver
          ? 'lost'
          : 'playing';

      setGuesses(nextGuesses);
      setStatus(nextStatus);
      if (nextStatus === 'won') recordOfficialResult('won');
      if (nextStatus === 'lost') recordOfficialResult('lost');
      setRevealed(data.revealed ?? null);
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
      const res = await fetch('/api/games/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, difficulty, date: date, session }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Pes etme işlemi başarısız');
        return;
      }

      setStatus('lost');
      setGaveUp(true);
      recordOfficialResult('lost');
      setRevealed(data.revealed ?? null);
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

  function handlePlayAgain() {
    const nextSession = session + 1;
    setSession(nextSession);
    setGuesses([]);
    setStatus('playing');
    setRevealed(null);
    setGaveUp(false);
    setConfirmGiveUp(false);
    setQuery('');
    setSelected(null);
    setSuggestions([]);
    setError(null);
    setDropdownOpen(false);

    saveState({
      date: date,
      mode,
      difficulty,
      session: nextSession,
      ...resetGameState(),
    });
  }

  return (
    <div className="relative mx-auto max-w-xl">
      <PitchDecoration />

      <header className="relative mb-8">
        <h1 className="text-[20px] font-medium text-ink">Günlük oyuncu tahmini</h1>
        <p className="mt-1 text-[13px] text-muted">
          Gizli futbolcuyu {MAX_GUESSES} denemede bul.
        </p>
      </header>

      <GameSetupPanel
        gameId="daily-player"
        date={date}
        onDateChange={setDate}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        timerEnabled={timerEnabled}
        onTimerEnabledChange={setTimerEnabled}
        disabled={loading}
      />

      <div className="relative mb-4 mt-3">
        <GameTimer
          enabled={timerEnabled}
          limitSec={timerLimitSec}
          running={status === 'playing'}
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

      {!gameOver && (
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
                        <img
                          src={player.clubCrest}
                          alt={player.club}
                          className="h-8 w-8 shrink-0 rounded-full bg-sidebar object-contain"
                        />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar text-[11px] font-semibold text-muted-light">
                          ({abbreviateClub(player.club)})
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
            Gizli oyuncu:{' '}
            <strong className="font-medium text-ink">{revealed.name}</strong>
            {' — '}
            {revealed.nationality}, {revealed.position}, {revealed.club}
            {revealed.age !== null ? `, ${revealed.age} yaş` : ''}
          </p>
          <button
            type="button"
            onClick={handlePlayAgain}
            className="mt-4 rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:bg-brand-dark"
          >
            Tekrar oyna
          </button>
        </div>
      )}

      {guesses.length > 0 && (
        <div className="relative space-y-3">
          {guesses.map((item, index) => (
            <GuessRow
              key={`${item.guess.id}-${index}`}
              item={item}
              isWinningRow={status === 'won' && index === guesses.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
