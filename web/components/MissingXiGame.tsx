'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { type DifficultyId } from '@/lib/difficulty-config';
import { shouldPersistGameState } from '@/lib/daily-access';
import { GAME_MODES, type GameModeId } from '@/lib/game-modes';
import { MAX_SLOT_ATTEMPTS, type LinePos } from '@/lib/missing-xi-shared';
import { kitForTeam, type KitColors } from '@/lib/team-kit';
import { normalizeAnswerLetters, type TileStatus } from '@/lib/wordle';
import { GameSetupPanel } from '@/components/GameSetupPanel';
import { GameTimer } from '@/components/GameTimer';
import { useGameShell } from '@/hooks/useGameShell';

interface TeamInfo {
  id: number;
  name: string;
  crest: string | null;
}

interface MatchMeta {
  matchId: number;
  teamId: number;
  competitionCode: string;
  competitionName: string;
  seasonLabel: string;
  date: string | null;
  focusTeam: TeamInfo;
  opponent: TeamInfo;
  isHome: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

interface SlotPublic {
  index: number;
  shirtNumber: number | null;
  position: LinePos;
  letterCounts: number[];
  totalLetters: number;
}

interface SlotState {
  status: 'open' | 'solved' | 'failed';
  revealedName?: string;
  revealedFullName?: string;
  attempts: string[];
  attemptTiles: TileStatus[][];
}

interface StoredGameState {
  date: string;
  mode: GameModeId;
  difficulty: DifficultyId;
  session: number;
  slots: Record<string, SlotState>;
  status: 'playing' | 'won' | 'lost';
  gaveUp?: boolean;
  meta?: MatchMeta;
  publicSlots?: SlotPublic[];
}

const MISSING_XI_MODES = GAME_MODES.filter(
  (m) => m.id === 'general' || m.id === 'cl' || m.id === 'top5'
);

const KEYBOARD_ROWS = [
  ['E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Ğ', 'Ü'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ş'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Ö', 'Ç', '⌫'],
];

function storageKey(
  mode: GameModeId,
  difficulty: DifficultyId,
  date: string,
  session: number
): string {
  return `football-missing-xi:v3:${mode}:${difficulty}:${date}:${session}`;
}

function sessionMetaKey(mode: GameModeId, difficulty: DifficultyId, date: string): string {
  return `football-missing-xi:v3:session:${mode}:${difficulty}:${date}`;
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

function emptySlotStates(): Record<string, SlotState> {
  const out: Record<string, SlotState> = {};
  for (let i = 0; i < 11; i++) {
    out[String(i)] = { status: 'open', attempts: [], attemptTiles: [] };
  }
  return out;
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${day}.${m}.${y}`;
}

function formatScore(meta: MatchMeta): string {
  if (meta.homeScore === null || meta.awayScore === null) return '—';
  return `${meta.homeScore} – ${meta.awayScore}`;
}

function normalizeTyped(ch: string): string | null {
  const folded = normalizeAnswerLetters(ch);
  if (folded.length === 1) return folded;
  return null;
}

/** Classic Wordle palette: green / yellow / gray */
function tileStyle(status: TileStatus | 'empty' | 'draft'): string {
  switch (status) {
    case 'correct':
      return 'bg-[#3B6D11] text-white border-[#3B6D11] shadow-sm';
    case 'present':
      return 'bg-[#C9A227] text-white border-[#C9A227] shadow-sm';
    case 'absent':
      return 'bg-[#787C7E] text-white border-[#787C7E]';
    case 'draft':
      return 'bg-page text-ink border-ink/40';
    default:
      return 'bg-page/80 text-muted-light border-line';
  }
}

function JerseyCard({
  number,
  kit,
  solved,
  failed,
  active,
}: {
  number: number | null;
  kit: KitColors;
  solved: boolean;
  failed: boolean;
  active: boolean;
}) {
  const fill = kit.stripe
    ? `repeating-linear-gradient(90deg, ${kit.primary} 0 10px, ${kit.secondary} 10px 20px)`
    : kit.primary;

  return (
    <div
      className={`relative transition-transform duration-300 xi-jersey-retro ${
        active ? 'scale-110 xi-pulse-active' : 'hover:scale-105'
      } ${solved ? 'drop-shadow-[0_0_12px_rgba(63,154,74,0.55)]' : ''} ${
        failed ? 'opacity-80 grayscale-[0.35]' : ''
      }`}
    >
      <svg viewBox="0 0 80 92" className="h-[76px] w-[66px] drop-shadow-md sm:h-[88px] sm:w-[76px]">
        <defs>
          {kit.stripe && (
            <pattern
              id={`stripe-${number}-${kit.primary}`}
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <rect width="6" height="12" fill={kit.primary} />
              <rect x="6" width="6" height="12" fill={kit.secondary} />
            </pattern>
          )}
        </defs>
        {/* sleeves */}
        <path
          d="M8 22 L2 34 L18 42 L22 28 Z"
          fill={kit.stripe ? kit.primary : kit.primary}
          opacity={0.92}
        />
        <path
          d="M72 22 L78 34 L62 42 L58 28 Z"
          fill={kit.stripe ? kit.primary : kit.primary}
          opacity={0.92}
        />
        {/* body */}
        <path
          d="M28 14 C32 8, 48 8, 52 14 L58 22 L62 84 C62 88, 18 88, 18 84 L22 22 Z"
          fill={kit.stripe ? `url(#stripe-${number}-${kit.primary})` : fill}
          stroke={kit.secondary}
          strokeWidth="1.5"
        />
        {/* collar */}
        <path d="M32 16 L40 24 L48 16" fill="none" stroke={kit.secondary} strokeWidth="2" />
      </svg>
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center pt-2 text-[22px] font-black tabular-nums sm:text-[26px]"
        style={{ color: kit.number, textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
      >
        {number ?? '—'}
      </span>
      {solved && (
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white shadow">
          ✓
        </span>
      )}
    </div>
  );
}

function LetterHint({
  counts,
  name,
  fullName,
}: {
  counts: number[];
  name?: string;
  fullName?: string;
}) {
  if (name) {
    return (
      <div className="mt-1 max-w-[88px] text-center sm:max-w-[100px]">
        <p className="text-[11px] font-semibold leading-tight text-ink sm:text-[12px]">{name}</p>
        {fullName && fullName !== name && (
          <p className="mt-0.5 text-[9px] leading-tight text-ink/55">{fullName}</p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-col items-center gap-1">
      {counts.map((n, i) => (
        <div key={i} className="flex gap-[3px]">
          {Array.from({ length: n }).map((_, j) => (
            <span
              key={j}
              className="h-[3px] w-[9px] rounded-full bg-ink/35 sm:h-[4px] sm:w-[11px]"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PitchRows({
  slots,
  slotStates,
  activeIndex,
  kit,
  onSelect,
}: {
  slots: SlotPublic[];
  slotStates: Record<string, SlotState>;
  activeIndex: number | null;
  kit: KitColors;
  onSelect: (index: number) => void;
}) {
  const rows: LinePos[] = ['F', 'M', 'D', 'G'];
  const byPos = new Map<LinePos, SlotPublic[]>();
  for (const pos of rows) byPos.set(pos, []);
  byPos.set('X', []);

  for (const slot of slots) {
    const list = byPos.get(slot.position) ?? byPos.get('X')!;
    list.push(slot);
  }

  const orderedRows = rows
    .map((pos) => ({ pos, items: byPos.get(pos) ?? [] }))
    .filter((r) => r.items.length > 0);

  const extras = byPos.get('X') ?? [];
  if (extras.length > 0) orderedRows.push({ pos: 'X', items: extras });

  return (
    <div className="relative z-[1] flex min-h-[560px] flex-1 flex-col justify-between gap-5 px-2 py-6 sm:min-h-[640px] sm:px-4 sm:py-8">
      {orderedRows.map((row, rowIdx) => (
        <div
          key={row.pos}
          className="xi-fade-up flex justify-center gap-3 sm:gap-5"
          style={{ animationDelay: `${rowIdx * 70}ms` }}
        >
          {row.items.map((slot) => {
            const state = slotStates[String(slot.index)] ?? {
              status: 'open' as const,
              attempts: [],
              attemptTiles: [],
            };
            const isActive = activeIndex === slot.index;
            const solved = state.status === 'solved';
            const failed = state.status === 'failed';
            const slotKit =
              slot.position === 'G' ? kitForTeam('', true) : kit;

            return (
              <button
                key={slot.index}
                type="button"
                onClick={() => onSelect(slot.index)}
                className="group flex w-[78px] flex-col items-center sm:w-[92px]"
              >
                <JerseyCard
                  number={slot.shirtNumber}
                  kit={slotKit}
                  solved={solved}
                  failed={failed}
                  active={isActive}
                />
                <LetterHint
                  counts={slot.letterCounts}
                  name={state.revealedName}
                  fullName={state.revealedFullName}
                />
                <span className="mt-1 text-[11px] font-medium tabular-nums text-ink/55">
                  {state.attempts.length}/{MAX_SLOT_ATTEMPTS}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function FlipTile({
  ch,
  status,
  delayMs,
  animate,
  size = 'md',
}: {
  ch: string;
  status: TileStatus | 'empty' | 'draft';
  delayMs: number;
  animate: boolean;
  size?: 'md' | 'lg';
}) {
  const [face, setFace] = useState<TileStatus | 'empty' | 'draft'>(
    animate ? 'draft' : status
  );
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (!animate || status === 'empty' || status === 'draft') {
      setFace(status);
      setFlipping(false);
      return;
    }
    setFace('draft');
    const start = window.setTimeout(() => setFlipping(true), delayMs);
    const mid = window.setTimeout(() => setFace(status), delayMs + 275);
    const end = window.setTimeout(() => setFlipping(false), delayMs + 550);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(mid);
      window.clearTimeout(end);
    };
  }, [animate, delayMs, status, ch]);

  const box =
    size === 'lg'
      ? 'h-12 w-11 text-[18px] sm:h-14 sm:w-12 sm:text-[20px]'
      : 'h-10 w-9 text-[15px] sm:h-11 sm:w-10 sm:text-[16px]';

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border-2 font-bold uppercase ${box} ${tileStyle(
        face
      )} ${flipping ? 'xi-tile-flip' : ''}`}
      style={{ perspective: '600px' }}
    >
      {ch}
    </span>
  );
}

function GuessRows({
  slot,
  slotState,
  draft,
  flipAttemptIndex,
}: {
  slot: SlotPublic;
  slotState: SlotState;
  draft: string;
  flipAttemptIndex: number | null;
}) {
  const rows: Array<{
    letters: string;
    tiles: Array<TileStatus | 'empty' | 'draft'>;
    animate: boolean;
  }> = [];

  for (let i = 0; i < MAX_SLOT_ATTEMPTS; i++) {
    if (i < slotState.attempts.length) {
      rows.push({
        letters: slotState.attempts[i],
        tiles: slotState.attemptTiles[i] ?? [],
        animate: flipAttemptIndex === i,
      });
    } else if (i === slotState.attempts.length && slotState.status === 'open') {
      let cursor = 0;
      const letters = slot.letterCounts
        .map((count) => {
          const part = draft.slice(cursor, cursor + count).padEnd(count, ' ');
          cursor += count;
          return part;
        })
        .join('');
      rows.push({
        letters,
        tiles: Array.from({ length: slot.totalLetters }, (_, j) =>
          draft[j] ? 'draft' : 'empty'
        ),
        animate: false,
      });
    } else {
      rows.push({
        letters: ' '.repeat(slot.totalLetters),
        tiles: Array(slot.totalLetters).fill('empty'),
        animate: false,
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
      {rows.map((row, ri) => {
        let idx = 0;
        return (
          <div key={ri} className="flex flex-wrap items-center justify-center gap-2">
            {slot.letterCounts.map((count, wi) => (
              <div key={wi} className="flex gap-1.5">
                {Array.from({ length: count }).map((_, li) => {
                  const status = row.tiles[idx] ?? 'empty';
                  const ch = (row.letters[idx] ?? ' ').trim();
                  const delay = idx * 120;
                  idx += 1;
                  return (
                    <FlipTile
                      key={`${ri}-${wi}-${li}`}
                      ch={ch}
                      status={status}
                      delayMs={delay}
                      animate={row.animate && status !== 'empty'}
                      size="lg"
                    />
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function GuessModal({
  slot,
  slotState,
  open,
  teamName,
  onClose,
  onSubmit,
  loading,
  error,
  flipAttemptIndex,
}: {
  slot: SlotPublic;
  slotState: SlotState;
  open: boolean;
  teamName: string;
  onClose: () => void;
  onSubmit: (guess: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  flipAttemptIndex: number | null;
}) {
  const [draft, setDraft] = useState('');
  const locked = slotState.status !== 'open';
  const maxLen = slot.totalLetters;
  const kit = kitForTeam(teamName, slot.position === 'G');

  useEffect(() => {
    if (open) setDraft('');
  }, [open, slot.index]);

  useEffect(() => {
    if (!open || locked) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (draft.length === maxLen && !loading) void onSubmit(draft);
        return;
      }
      const ch = normalizeTyped(e.key);
      if (ch) {
        e.preventDefault();
        setDraft((d) => (d.length < maxLen ? d + ch : d));
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, locked, draft, maxLen, loading, onClose, onSubmit]);

  if (!open) return null;

  function handleKey(key: string) {
    if (locked || loading) return;
    if (key === '⌫') {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    if (key === 'ENTER') {
      if (draft.length === maxLen) void onSubmit(draft);
      return;
    }
    setDraft((d) => {
      const ch = normalizeTyped(key);
      if (!ch || d.length >= maxLen) return d;
      return d + ch;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-3 backdrop-blur-[2px] sm:p-6">
      <div className="xi-fade-up flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-page shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7 sm:py-5">
          <div className="flex items-center gap-4">
            <JerseyCard
              number={slot.shirtNumber}
              kit={kit}
              solved={slotState.status === 'solved'}
              failed={slotState.status === 'failed'}
              active={false}
            />
            <div>
              <p className="text-[16px] font-semibold text-ink sm:text-[18px]">
                Forma #{slot.shirtNumber ?? '?'}
                <span className="ml-2 text-[13px] font-medium text-muted">
                  · {slot.position}
                </span>
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {locked
                  ? slotState.status === 'solved'
                    ? 'Doğru tahmin!'
                    : 'Bu oyuncu için haklar bitti'
                  : `${MAX_SLOT_ATTEMPTS - slotState.attempts.length} tahmin hakkı kaldı`}
              </p>
              {slotState.revealedName && (
                <div className="mt-1">
                  <p className="text-[15px] font-medium text-brand-dark">
                    {slotState.revealedName}
                  </p>
                  {slotState.revealedFullName &&
                    slotState.revealedFullName !== slotState.revealedName && (
                      <p className="text-[12px] text-muted">{slotState.revealedFullName}</p>
                    )}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-medium text-muted transition hover:border-muted-light hover:text-ink"
          >
            Kapat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
          <GuessRows
            slot={slot}
            slotState={slotState}
            draft={draft}
            flipAttemptIndex={flipAttemptIndex}
          />

          <div className="mt-4 flex items-center justify-center gap-4 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#3B6D11]" /> Doğru yer
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#C9A227]" /> Yanlış yer
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-[#787C7E]" /> Yok
            </span>
          </div>

          {error && (
            <p className="mt-3 text-center text-[13px] text-miss-dark">{error}</p>
          )}
        </div>

        {!locked && (
          <div className="border-t border-line bg-sidebar/80 px-3 py-3 sm:px-5 sm:py-4">
            <div className="space-y-1.5">
              {KEYBOARD_ROWS.map((row) => (
                <div key={row.join('-')} className="flex justify-center gap-1 sm:gap-1.5">
                  {row.map((key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={loading}
                      onClick={() => handleKey(key)}
                      className={`rounded-md border border-line bg-page px-2 py-2.5 text-[13px] font-semibold text-ink shadow-sm transition hover:border-brand/40 hover:bg-brand-light/50 disabled:opacity-40 sm:px-2.5 sm:py-3 sm:text-[14px] ${
                        key === 'ENTER' || key === '⌫'
                          ? 'min-w-[52px] px-3 text-[12px] sm:min-w-[64px]'
                          : 'min-w-[30px] sm:min-w-[34px]'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MissingXiGame() {
  const shell = useGameShell('missing-xi');
  const { date, setDate, timerEnabled, setTimerEnabled, timerLimitSec, recordOfficialResult } =
    shell;
  const [mode, setMode] = useState<GameModeId>('general');
  const [difficulty, setDifficulty] = useState<DifficultyId>('easy');
  const [session, setSession] = useState(0);
  const [meta, setMeta] = useState<MatchMeta | null>(null);
  const [slots, setSlots] = useState<SlotPublic[]>([]);
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>(emptySlotStates);
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [loadingPuzzle, setLoadingPuzzle] = useState(true);
  const [guessLoading, setGuessLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [flipAttemptIndex, setFlipAttemptIndex] = useState<number | null>(null);

  const solvedCount = useMemo(
    () => Object.values(slotStates).filter((s) => s.status === 'solved').length,
    [slotStates]
  );

  const focusKit = useMemo(
    () => kitForTeam(meta?.focusTeam.name ?? ''),
    [meta?.focusTeam.name]
  );

  const fetchPuzzle = useCallback(
    async (nextMode: GameModeId, nextDifficulty: DifficultyId, nextSession: number) => {
      const res = await fetch(
        `/api/games/missing-xi/puzzle?mode=${nextMode}&difficulty=${nextDifficulty}&date=${date}&session=${nextSession}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Bulmaca yüklenemedi');
      return data as { meta: MatchMeta; slots: SlotPublic[] };
    },
    [date]
  );

  const restoreForSettings = useCallback(
    async (nextMode: GameModeId, nextDifficulty: DifficultyId) => {
      const preferred = getPreferredSession(nextMode, nextDifficulty, date);
      const saved = loadState(nextMode, nextDifficulty, date, preferred);

      setSession(preferred);
      setLoadingPuzzle(true);
      setError(null);
      setConfirmGiveUp(false);
      setActiveSlot(null);
      setModalError(null);
      setFlipAttemptIndex(null);

      try {
        if (saved?.meta && saved.publicSlots?.length === 11) {
          setMeta(saved.meta);
          setSlots(saved.publicSlots);
          setSlotStates(saved.slots);
          setStatus(saved.status);
          setGaveUp(saved.gaveUp ?? false);
        } else {
          const puzzle = await fetchPuzzle(nextMode, nextDifficulty, preferred);
          const nextSlots = emptySlotStates();
          setMeta(puzzle.meta);
          setSlots(puzzle.slots);
          setSlotStates(nextSlots);
          setStatus('playing');
          setGaveUp(false);
          saveState({
            date: date,
            mode: nextMode,
            difficulty: nextDifficulty,
            session: preferred,
            slots: nextSlots,
            status: 'playing',
            meta: puzzle.meta,
            publicSlots: puzzle.slots,
          });
        }
      } catch (err) {
        setMeta(null);
        setSlots([]);
        setError(err instanceof Error ? err.message : 'Bulmaca yüklenemedi');
      } finally {
        setLoadingPuzzle(false);
      }
    },
    [date, fetchPuzzle]
  );

  useEffect(() => {
    void restoreForSettings(mode, difficulty);
  }, [mode, difficulty, date, restoreForSettings]);

  async function handleGuess(guess: string) {
    if (activeSlot === null || status !== 'playing' || guessLoading) return;
    const key = String(activeSlot);
    const current = slotStates[key];
    if (!current || current.status !== 'open') return;

    setGuessLoading(true);
    setModalError(null);

    try {
      const res = await fetch('/api/games/missing-xi/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          difficulty,
          date: date,
          session,
          slotIndex: activeSlot,
          guess,
          attemptNumber: current.attempts.length + 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setModalError(data.error ?? 'Tahmin gönderilemedi');
        return;
      }

      const attemptIdx = current.attempts.length;
      const nextState: SlotState = {
        ...current,
        attempts: [...current.attempts, normalizeAnswerLetters(guess)],
        attemptTiles: [...current.attemptTiles, data.tiles as TileStatus[]],
        status: data.correct ? 'solved' : data.gameOverSlot ? 'failed' : 'open',
        revealedName: data.revealedName ?? current.revealedName,
        revealedFullName: data.revealedFullName ?? current.revealedFullName,
      };

      const nextSlots = { ...slotStates, [key]: nextState };
      const solved = Object.values(nextSlots).filter((s) => s.status === 'solved').length;
      const nextStatus: StoredGameState['status'] = solved === 11 ? 'won' : 'playing';

      setSlotStates(nextSlots);
      setStatus(nextStatus);
      if (nextStatus === 'won') recordOfficialResult('won');
      setFlipAttemptIndex(attemptIdx);
      window.setTimeout(() => setFlipAttemptIndex(null), 120 * (data.tiles?.length ?? 8) + 700);

      saveState({
        date: date,
        mode,
        difficulty,
        session,
        slots: nextSlots,
        status: nextStatus,
        gaveUp: false,
        meta: meta ?? undefined,
        publicSlots: slots,
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
      const res = await fetch('/api/games/missing-xi/give-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, difficulty, date: date, session }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Pes etme başarısız');
        return;
      }

      const nextSlots = { ...slotStates };
      for (const p of data.players as Array<{
        index: number;
        name: string;
        fullName?: string;
      }>) {
        const k = String(p.index);
        const prev = nextSlots[k] ?? { status: 'open' as const, attempts: [], attemptTiles: [] };
        nextSlots[k] = {
          ...prev,
          status: prev.status === 'solved' ? 'solved' : 'failed',
          revealedName: p.name,
          revealedFullName: p.fullName ?? p.name,
        };
      }

      setSlotStates(nextSlots);
      setStatus('lost');
      setGaveUp(true);
      recordOfficialResult('lost');
      setConfirmGiveUp(false);
      setActiveSlot(null);

      saveState({
        date: date,
        mode,
        difficulty,
        session,
        slots: nextSlots,
        status: 'lost',
        gaveUp: true,
        meta: meta ?? undefined,
        publicSlots: slots,
      });
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
    } finally {
      setGuessLoading(false);
    }
  }

  async function handlePlayAgain() {
    const nextSession = session + 1;
    setSession(nextSession);
    setLoadingPuzzle(true);
    setActiveSlot(null);
    setConfirmGiveUp(false);
    setError(null);
    setFlipAttemptIndex(null);
    try {
      const puzzle = await fetchPuzzle(mode, difficulty, nextSession);
      const nextSlots = emptySlotStates();
      setMeta(puzzle.meta);
      setSlots(puzzle.slots);
      setSlotStates(nextSlots);
      setStatus('playing');
      setGaveUp(false);
      saveState({
        date: date,
        mode,
        difficulty,
        session: nextSession,
        slots: nextSlots,
        status: 'playing',
        meta: puzzle.meta,
        publicSlots: puzzle.slots,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulmaca yüklenemedi');
    } finally {
      setLoadingPuzzle(false);
    }
  }

  const activeSlotPublic = activeSlot !== null ? slots.find((s) => s.index === activeSlot) : null;
  const activeSlotState =
    activeSlot !== null
      ? slotStates[String(activeSlot)] ?? {
          status: 'open' as const,
          attempts: [],
          attemptTiles: [],
        }
      : null;

  return (
    <div className="relative mx-auto w-full max-w-[1280px]">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        {/* LEFT: info + options */}
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-[300px] xl:w-[320px]">
          <header className="mb-5">
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">Kayıp 11</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
              İlk 11&apos;i Wordle tarzı harf tahminleriyle tamamla.
            </p>
          </header>

          <GameSetupPanel
            gameId="missing-xi"
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

          <div className="mb-3 mt-2">
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

          <div className="mb-3 flex flex-wrap gap-2">
            {MISSING_XI_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`rounded-pill px-3.5 py-1.5 text-[13px] font-medium transition ${
                  mode === m.id
                    ? 'bg-brand text-white shadow-sm'
                    : 'border border-line bg-page text-muted hover:border-muted-light'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {loadingPuzzle ? (
            <p className="text-[13px] text-muted">Maç yükleniyor…</p>
          ) : error && !meta ? (
            <p className="text-[13px] text-miss-dark">{error}</p>
          ) : meta ? (
            <div className="xi-fade-up space-y-4">
              <div className="rounded-card border border-line bg-gradient-to-br from-page to-sidebar p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-light">
                  {meta.competitionName}
                </p>
                <p className="mt-1 text-[15px] font-medium text-ink">{meta.seasonLabel}</p>
                <p className="mt-3 text-[22px] font-semibold tabular-nums text-ink">
                  {formatScore(meta)}
                </p>
                <p className="text-[12px] text-muted">{formatMatchDate(meta.date)}</p>
              </div>

              <div className="rounded-card border border-line bg-page p-4 shadow-sm">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-light">
                  Tahmin XI
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full shadow-inner"
                    style={{ background: focusKit.primary }}
                  >
                    {meta.focusTeam.crest ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={meta.focusTeam.crest}
                        alt=""
                        className="h-9 w-9 object-contain"
                      />
                    ) : (
                      <span
                        className="text-[11px] font-bold"
                        style={{ color: focusKit.number }}
                      >
                        XI
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-ink">
                      {meta.focusTeam.name}
                    </p>
                    <p className="text-[12px] text-muted">
                      {meta.isHome ? 'Ev sahibi' : 'Deplasman'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-card border border-line bg-page p-4 shadow-sm">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-light">
                  Rakip
                </p>
                <div className="flex items-center gap-3">
                  {meta.opponent.crest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={meta.opponent.crest}
                      alt=""
                      className="h-10 w-10 rounded-full bg-sidebar object-contain"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar text-[11px] font-bold text-muted">
                      ?
                    </div>
                  )}
                  <p className="truncate text-[15px] font-medium text-ink">{meta.opponent.name}</p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-card border border-brand-border/50 bg-brand-light/60 px-4 py-3">
                <p className="text-[14px] font-semibold text-brand-dark">
                  {solvedCount}
                  <span className="font-medium text-muted"> / 11</span>
                </p>
                {status === 'playing' && (
                  <div>
                    {!confirmGiveUp ? (
                      <button
                        type="button"
                        onClick={() => setConfirmGiveUp(true)}
                        disabled={guessLoading}
                        className="text-[13px] font-medium text-muted transition hover:text-miss-dark disabled:opacity-40"
                      >
                        Pes etme
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleGiveUp()}
                          disabled={guessLoading}
                          className="rounded-md border border-miss-dark bg-miss-light px-3 py-1.5 text-[12px] font-medium text-miss-dark disabled:opacity-40"
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

              {error && <p className="text-[12px] text-miss-dark">{error}</p>}

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
                      ? 'Tebrikler! İlk 11 tamam.'
                      : gaveUp
                        ? 'Pes ettiniz — cevaplar açıldı.'
                        : 'Tur bitti.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handlePlayAgain()}
                    className="mt-3 rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white transition hover:bg-brand-dark"
                  >
                    Tekrar oyna
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </aside>

        {/* RIGHT: pitch */}
        <section className="min-w-0 flex-1">
          {meta && !loadingPuzzle ? (
            <div className="xi-fade-up xi-stage-retro relative overflow-hidden rounded-2xl shadow-lg">
              <div className="xi-pitch-retro absolute inset-0" />
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg, transparent 0 32px, rgba(42,36,24,0.08) 32px 64px)',
                }}
              />
              {/* pitch markings */}
              <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-px -translate-y-1/2 bg-[#f3e6c8]/45" />
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#f3e6c8]/40 sm:h-36 sm:w-36" />
              <div className="pointer-events-none absolute inset-x-[22%] top-0 h-16 border-x border-b border-[#f3e6c8]/35 sm:h-20" />
              <div className="pointer-events-none absolute inset-x-[22%] bottom-0 h-16 border-x border-t border-[#f3e6c8]/35 sm:h-20" />

              <PitchRows
                slots={slots}
                slotStates={slotStates}
                activeIndex={activeSlot}
                kit={focusKit}
                onSelect={(index) => {
                  setModalError(null);
                  setFlipAttemptIndex(null);
                  setActiveSlot(index);
                }}
              />
            </div>
          ) : (
            !loadingPuzzle && (
              <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-line bg-sidebar text-[14px] text-muted">
                Sol taraftan mod / zorluk seçerek başla
              </div>
            )
          )}
        </section>
      </div>

      {activeSlotPublic && activeSlotState && meta && (
        <GuessModal
          slot={activeSlotPublic}
          slotState={activeSlotState}
          open={activeSlot !== null}
          teamName={meta.focusTeam.name}
          onClose={() => {
            setActiveSlot(null);
            setFlipAttemptIndex(null);
          }}
          onSubmit={handleGuess}
          loading={guessLoading}
          error={modalError}
          flipAttemptIndex={flipAttemptIndex}
        />
      )}
    </div>
  );
}
