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
import { GameTitle } from '@/components/GameHelpButton';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';
import type {
  AgeCompareStatus,
  ComparisonResult,
  MatchStatus,
  NumberCompareStatus,
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

type TraitCategory = 'nationality' | 'league' | 'club' | 'position' | 'age' | 'shirt';

const TRAIT_ORDER: TraitCategory[] = [
  'nationality',
  'league',
  'club',
  'position',
  'age',
  'shirt',
];

const CARD_STAGGER_MS = 180;

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

function categoryLabel(category: TraitCategory): string {
  switch (category) {
    case 'nationality':
      return 'Milliyet';
    case 'league':
      return 'Lig';
    case 'position':
      return 'Mevki';
    case 'club':
      return 'Kulüp';
    case 'age':
      return 'Yaş';
    case 'shirt':
      return 'Forma no';
  }
}

function categoryShortLabel(category: TraitCategory): string {
  switch (category) {
    case 'nationality':
      return 'MİL';
    case 'league':
      return 'LİG';
    case 'position':
      return 'MEVKİ';
    case 'club':
      return 'KULÜP';
    case 'age':
      return 'YAŞ';
    case 'shirt':
      return 'NO';
  }
}

function traitStatus(
  category: TraitCategory,
  comparison: ComparisonResult
): MatchStatus | AgeCompareStatus | NumberCompareStatus {
  switch (category) {
    case 'nationality':
      return comparison.nationality;
    case 'league':
      return comparison.league;
    case 'club':
      return comparison.club;
    case 'position':
      return comparison.position;
    case 'age':
      return comparison.age;
    case 'shirt':
      return comparison.shirtNumber;
  }
}

function badgeTitle(
  category: TraitCategory,
  status: MatchStatus | AgeCompareStatus | NumberCompareStatus,
  detail?: string
): string {
  const label = categoryLabel(category);
  if (status === 'match') return `${label}: eşleşti`;
  if (status === 'miss') return `${label}: eşleşmedi${detail ? ` (${detail})` : ''}`;
  if (status === 'older') {
    return category === 'shirt'
      ? `${label}: hedef numara daha büyük`
      : `${label}: hedef daha yaşlı`;
  }
  if (status === 'younger') {
    return category === 'shirt'
      ? `${label}: hedef numara daha küçük`
      : `${label}: hedef daha genç`;
  }
  return `${label}: bilinmiyor`;
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

function displayPosition(position: string): string {
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

function cardSurface(
  category: TraitCategory,
  status: MatchStatus | AgeCompareStatus | NumberCompareStatus,
  isWinningRow: boolean
): { circle: string; label: string; showArrow: 'older' | 'younger' | null } {
  if (isWinningRow) {
    return {
      circle: 'bg-brand-border text-brand-darker ring-2 ring-brand-border/60',
      label: 'text-muted-light',
      showArrow: null,
    };
  }

  const isDirectional = category === 'age' || category === 'shirt';

  if (isDirectional) {
    if (status === 'match') {
      return {
        circle: 'bg-brand-light text-brand-dark ring-2 ring-brand-border/50',
        label: 'text-muted-light',
        showArrow: null,
      };
    }
    if (status === 'older' || status === 'younger') {
      return {
        circle: 'bg-hint-light text-hint-dark ring-2 ring-hint-light',
        label: 'text-muted-light',
        showArrow: status,
      };
    }
    return {
      circle: 'bg-sidebar text-muted-light ring-1 ring-line',
      label: 'text-muted-light',
      showArrow: null,
    };
  }

  if (status === 'match') {
    return {
      circle: 'bg-brand-light text-brand-dark ring-2 ring-brand-border/50',
      label: 'text-muted-light',
      showArrow: null,
    };
  }

  return {
    circle: 'bg-miss-light text-miss-dark ring-2 ring-miss-light',
    label: 'text-muted-light',
    showArrow: null,
  };
}

function DirectionalValue({
  value,
  showArrow,
  size = 'sm',
}: {
  value: string;
  showArrow: 'older' | 'younger' | null;
  size?: 'sm' | 'md';
}) {
  const textClass =
    size === 'md'
      ? 'text-[12px] font-bold leading-none sm:text-[13px]'
      : 'text-[11px] font-bold leading-none sm:text-xs';

  return (
    <div className="flex items-center justify-center gap-0.5">
      <span className={textClass}>{value}</span>
      {showArrow === 'older' && (
        <ArrowUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
      )}
      {showArrow === 'younger' && (
        <ArrowDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
      )}
    </div>
  );
}

function AssetCircleImage({
  src,
  alt,
  fallback,
  className,
}: {
  src: string | null;
  alt: string;
  fallback: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className="text-[10px] font-bold leading-none sm:text-[11px]">{fallback}</span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function TraitCard({
  category,
  comparison,
  guess,
  isWinningRow,
  animate,
  delayMs,
}: {
  category: TraitCategory;
  comparison: ComparisonResult;
  guess: PlayerDisplay;
  isWinningRow: boolean;
  animate: boolean;
  delayMs: number;
}) {
  const status = traitStatus(category, comparison);
  const { circle, label, showArrow } = cardSurface(category, status, isWinningRow);

  const detail =
    category === 'nationality'
      ? guess.nationality
      : category === 'league'
        ? guess.league
        : category === 'position'
          ? guess.position
          : category === 'club'
            ? guess.club
            : category === 'age'
              ? guess.age !== null
                ? String(guess.age)
                : undefined
              : guess.shirtNumber !== null
                ? String(guess.shirtNumber)
                : undefined;

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center gap-1.5 ${animate ? 'dp-card-drop' : ''}`}
      style={animate ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div
        title={badgeTitle(category, status, detail)}
        className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full sm:h-14 sm:w-14 ${circle}`}
      >
        {isWinningRow ? (
          <Check className="h-5 w-5" strokeWidth={2.5} />
        ) : category === 'nationality' ? (
          <AssetCircleImage
            src={guess.nationalityFlag}
            alt={guess.nationality}
            fallback={guess.nationality.slice(0, 3).toUpperCase()}
            className="h-7 w-7 object-contain sm:h-8 sm:w-8"
          />
        ) : category === 'league' ? (
          <AssetCircleImage
            src={guess.leagueEmblem}
            alt={guess.league}
            fallback={guess.leagueCode}
            className="h-7 w-7 object-contain sm:h-8 sm:w-8"
          />
        ) : category === 'club' ? (
          <AssetCircleImage
            src={guess.clubCrest}
            alt={guess.club}
            fallback={abbreviateClub(guess.club)}
            className="h-8 w-8 object-contain sm:h-9 sm:w-9"
          />
        ) : category === 'position' ? (
          <span className="text-[11px] font-bold leading-none sm:text-xs">
            {displayPosition(guess.position)}
          </span>
        ) : category === 'age' ? (
          <DirectionalValue
            value={guess.age !== null ? String(guess.age) : '?'}
            showArrow={showArrow}
            size="md"
          />
        ) : (
          <DirectionalValue
            value={guess.shirtNumber !== null ? `#${guess.shirtNumber}` : '?'}
            showArrow={showArrow}
          />
        )}
      </div>
      <span className={`text-[9px] font-bold uppercase tracking-wider sm:text-[10px] ${label}`}>
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

function GuessRow({
  item,
  isWinningRow,
  animate,
}: {
  item: StoredGuess;
  isWinningRow: boolean;
  animate: boolean;
}) {
  const { guess, comparison } = item;

  return (
    <div
      className={`dp-guess-row rounded-card px-3 py-4 sm:px-4 ${
        isWinningRow ? 'border-[1.5px] border-brand-border bg-brand-light' : ''
      }`}
    >
      <p className="mb-4 text-center text-[13px] font-bold uppercase tracking-[0.08em] text-ink sm:text-[14px]">
        {guess.name}
      </p>
      <div className="flex justify-center gap-1 sm:gap-2">
        {TRAIT_ORDER.map((category, index) => (
          <TraitCard
            key={category}
            category={category}
            comparison={comparison}
            guess={guess}
            isWinningRow={isWinningRow}
            animate={animate}
            delayMs={index * CARD_STAGGER_MS}
          />
        ))}
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
  const [animateLatestRow, setAnimateLatestRow] = useState(false);
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
      setAnimateLatestRow(false);
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
      setAnimateLatestRow(true);
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

  return (
    <div className="relative mx-auto max-w-xl">
      <PitchDecoration />

      <header className="relative mb-8">
        <GameTitle gameId="daily-player" className="text-[20px] font-medium text-ink" size="sm">
          Günlük oyuncu tahmini
        </GameTitle>
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
                        // eslint-disable-next-line @next/next/no-img-element
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
                      {displayPosition(player.position)}
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
            {revealed.nationality}, {revealed.league}, {revealed.position}, {revealed.club}
            {revealed.age !== null ? `, ${revealed.age} yaş` : ''}
            {revealed.shirtNumber !== null ? `, #${revealed.shirtNumber}` : ''}
          </p>
        </div>
      )}

      {guesses.length > 0 && (
        <div className="relative space-y-3">
          {guesses.map((item, index) => (
            <GuessRow
              key={`${item.guess.id}-${index}`}
              item={item}
              isWinningRow={status === 'won' && index === guesses.length - 1}
              animate={animateLatestRow && index === guesses.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
