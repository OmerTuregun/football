'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { type DifficultyId } from '@/lib/difficulty-config';
import { GAME_MODES, type GameModeId } from '@/lib/game-modes';
import { isGameStartBlocked } from '@/lib/daily-access';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';

type StatCategory = 'age' | 'clubCount' | 'goals' | 'assists' | 'marketValue';

interface PlayerCard {
  id: number;
  name: string;
  nationality: string;
  position: string;
  club: string;
  clubCrest: string | null;
}

interface ChallengeResponse {
  player: PlayerCard;
  category: StatCategory;
}

interface RevealCompareResponse {
  referenceValue: number;
  challengerValue: number;
  correct: boolean;
  category: StatCategory;
}

type RoundFlash = 'correct' | 'wrong' | null;

const CATEGORY_LABEL: Record<StatCategory, string> = {
  age: 'YAŞ',
  clubCount: 'KULÜP SAYISI',
  goals: 'GOL',
  assists: 'ASİST',
  marketValue: 'PİYASA DEĞERİ',
};

function formatStatValue(value: number, category: StatCategory | null): string {
  if (category === 'marketValue') {
    if (value >= 1_000_000) {
      const millions = value / 1_000_000;
      const rounded = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10;
      return `€${rounded}M`;
    }
    if (value >= 1_000) {
      return `€${Math.round(value / 1_000)}K`;
    }
    return `€${value}`;
  }
  return String(value);
}

function bestStreakKey(mode: GameModeId): string {
  return `football-higher-lower:best:${mode}`;
}

function loadBestStreak(mode: GameModeId): number {
  if (typeof window === 'undefined') return 0;
  const raw = localStorage.getItem(bestStreakKey(mode));
  const parsed = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function saveBestStreak(mode: GameModeId, score: number): void {
  const current = loadBestStreak(mode);
  if (score > current) {
    localStorage.setItem(bestStreakKey(mode), String(score));
  }
}

function PlayerSideCard({
  player,
  value,
  valueHidden,
  label,
  flash,
  category,
}: {
  player: PlayerCard;
  value: number | null;
  valueHidden: boolean;
  label: string;
  flash: RoundFlash;
  category: StatCategory | null;
}) {
  const flashClass =
    flash === 'correct'
      ? 'border-brand-border bg-brand-light'
      : flash === 'wrong'
        ? 'border-miss-light bg-miss-light/50'
        : 'border-line bg-page';

  return (
    <div
      className={`rounded-card border p-4 transition-colors duration-300 sm:p-5 ${flashClass}`}
    >
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-light">
        {label}
      </p>

      <div className="mb-4 flex items-center gap-3">
        {player.clubCrest ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.clubCrest}
            alt={player.club}
            className="h-12 w-12 shrink-0 rounded-full bg-sidebar object-contain"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sidebar text-[12px] font-semibold text-muted-light">
            ?
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[16px] font-medium text-ink">{player.name}</p>
          <p className="truncate text-[13px] text-muted">{player.club}</p>
          <p className="truncate text-[12px] text-muted-light">{player.nationality}</p>
        </div>
      </div>

      <div className="rounded-md bg-sidebar px-3 py-4 text-center">
        {valueHidden ? (
          <p className="text-[28px] font-semibold tracking-widest text-muted-light">???</p>
        ) : (
          <p className="text-[28px] font-semibold tabular-nums text-ink sm:text-[32px]">
            {value !== null ? formatStatValue(value, category) : '—'}
          </p>
        )}
      </div>
    </div>
  );
}

export function HigherLowerGame() {
  const shell = useGameShell('higher-lower');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [mode, setMode] = useState<GameModeId>('general');
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [category, setCategory] = useState<StatCategory | null>(null);
  const [reference, setReference] = useState<PlayerCard | null>(null);
  const [referenceValue, setReferenceValue] = useState<number | null>(null);
  const [challenger, setChallenger] = useState<PlayerCard | null>(null);
  const [challengerValue, setChallengerValue] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [status, setStatus] = useState<'loading' | 'playing' | 'lost'>('loading');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<RoundFlash>(null);
  const [finalScore, setFinalScore] = useState(0);

  const fetchChallenge = useCallback(
    async (
      excludeId?: number,
      category?: StatCategory,
      anchorId?: number
    ): Promise<ChallengeResponse> => {
      const params = new URLSearchParams({ mode, difficulty });
      if (excludeId !== undefined) params.set('excludeId', String(excludeId));
      if (category) params.set('category', category);
      if (anchorId !== undefined) params.set('anchorId', String(anchorId));
      const res = await fetch(`/api/games/higher-lower/challenge?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Challenge failed');
      return data as ChallengeResponse;
    },
    [mode, difficulty]
  );

  const fetchReferenceValue = useCallback(
    async (playerId: number, cat: StatCategory): Promise<number> => {
      const res = await fetch('/api/games/higher-lower/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, category: cat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Value reveal failed');
      return data.value as number;
    },
    []
  );

  const startRound = useCallback(async () => {
    if (isGameStartBlocked('higher-lower', date)) {
      setStatus('lost');
      setLoading(false);
      return;
    }
    setStatus('loading');
    setLoading(true);
    setError(null);
    setFlash(null);
    setChallengerValue(null);
    setScore(0);
    setFinalScore(0);

    try {
      const first = await fetchChallenge();
      const value = await fetchReferenceValue(first.player.id, first.category);
      const second = await fetchChallenge(first.player.id, first.category);

      setReference(first.player);
      setReferenceValue(value);
      setCategory(first.category);
      setChallenger(second.player);
      setStatus('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Oyun başlatılamadı');
      setStatus('lost');
    } finally {
      setLoading(false);
    }
  }, [fetchChallenge, fetchReferenceValue, date]);

  useEffect(() => {
    setBest(loadBestStreak(mode));
    void startRound();
  }, [mode, difficulty, date, startRound]);

  async function handleGuess(guess: 'higher' | 'lower') {
    if (!reference || !challenger || !category || status !== 'playing' || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/higher-lower/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceId: reference.id,
          challengerId: challenger.id,
          category,
          guess,
        }),
      });
      const data = (await res.json()) as RevealCompareResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Tahmin kontrol edilemedi');

      setChallengerValue(data.challengerValue);
      setReferenceValue(data.referenceValue);

      if (data.correct) {
        const nextScore = score + 1;
        setScore(nextScore);
        saveBestStreak(mode, nextScore);
        setBest(loadBestStreak(mode));
        setFlash('correct');

        await new Promise((r) => setTimeout(r, 700));

        // Promote challenger → reference; pick new challenger + category
        // anchorId ensures the promoted reference has the next category's stat
        const next = await fetchChallenge(challenger.id, undefined, challenger.id);
        const nextRefValue = await fetchReferenceValue(challenger.id, next.category);

        setReference(challenger);
        setReferenceValue(nextRefValue);
        setCategory(next.category);
        setChallenger(next.player);
        setChallengerValue(null);
        setFlash(null);
      } else {
        setFlash('wrong');
        setFinalScore(score);
        saveBestStreak(mode, score);
        setBest(loadBestStreak(mode));
        setStatus('lost');
        recordOfficialResult('lost');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-2xl">
      <header className="relative mb-8">
        <h1 className="text-[20px] font-medium text-ink">Kim Daha Çok</h1>
        <p className="mt-1 text-[13px] text-muted">
          Sağdaki oyuncu için daha fazla mı, daha az mı? Serini bozma.
        </p>
      </header>

      <GameSetupPanel
        gameId="higher-lower"
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
              setFinalScore(score);
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

      <div className="relative mb-6 flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Seri: <span className="font-semibold text-ink">{score}</span>
        </p>
        <p className="text-[13px] text-muted">
          En iyi: <span className="font-semibold text-ink">{best}</span>
        </p>
      </div>

      {category && (
        <div className="relative mb-6 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-light">
            Kategori
          </p>
          <h2 className="mt-1 text-[28px] font-semibold tracking-wide text-ink sm:text-[32px]">
            {CATEGORY_LABEL[category]}
          </h2>
        </div>
      )}

      {status === 'loading' && (
        <p className="text-center text-[13px] text-muted">Oyuncular yükleniyor…</p>
      )}

      {reference && challenger && (
        <div className="relative mb-6 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <PlayerSideCard
            player={reference}
            value={referenceValue}
            valueHidden={false}
            label="Referans"
            flash={flash === 'correct' ? 'correct' : null}
            category={category}
          />

          <div className="flex flex-col items-center justify-center gap-2 py-2 sm:px-2">
            <span className="text-[12px] font-medium text-muted-light">VS</span>
            {status === 'playing' && (
              <div className="flex w-full flex-row gap-2 sm:w-auto sm:flex-col">
                <button
                  type="button"
                  onClick={() => handleGuess('higher')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-4 py-3 text-[13px] font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:min-w-[120px]"
                >
                  <ArrowUp className="h-4 w-4" />
                  Daha fazla
                </button>
                <button
                  type="button"
                  onClick={() => handleGuess('lower')}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-page px-4 py-3 text-[13px] font-medium text-ink transition hover:border-muted-light disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:min-w-[120px]"
                >
                  <ArrowDown className="h-4 w-4" />
                  Daha az
                </button>
              </div>
            )}
          </div>

          <PlayerSideCard
            player={challenger}
            value={challengerValue}
            valueHidden={challengerValue === null}
            label="Meydan okuyan"
            flash={flash}
            category={category}
          />
        </div>
      )}

      {error && <p className="mb-4 text-center text-[12px] text-miss-dark">{error}</p>}

      {status === 'lost' && !error && (
        <div className="relative mb-8 rounded-card border border-miss-light bg-miss-light/50 p-4 text-center">
          <p className="text-[14px] font-medium text-ink">Seri bitti.</p>
          <p className="mt-1.5 text-[13px] text-muted">
            Skorun: <strong className="font-medium text-ink">{finalScore}</strong>
            {challengerValue !== null && referenceValue !== null && (
              <>
                {' '}
                — doğru cevap{' '}
                <strong className="font-medium text-ink">
                  {formatStatValue(challengerValue, category)}
                </strong>{' '}
                idi (referans: {formatStatValue(referenceValue, category)})
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => void startRound()}
            className="mt-4 rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:bg-brand-dark"
          >
            Tekrar oyna
          </button>
        </div>
      )}
    </div>
  );
}
