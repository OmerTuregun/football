import { NextRequest, NextResponse } from 'next/server';

import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { ONLUK_LIVES, ONLUK_SIZE } from '@/lib/onluk-shared';
import { guessOnluk } from '@/lib/onluk';

export const dynamic = 'force-dynamic';

interface GuessBody {
  difficulty?: string;
  date?: string;
  session?: number;
  playerId?: number;
  placedIds?: number[];
  livesLeft?: number;
  streakCorrect?: number;
}

export async function POST(request: NextRequest) {
  let body: GuessBody;
  try {
    body = (await request.json()) as GuessBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    difficulty = 'easy',
    date,
    session = 0,
    playerId,
    placedIds = [],
    livesLeft = ONLUK_LIVES,
    streakCorrect = 0,
  } = body;

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }
  if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  if (!Array.isArray(placedIds) || placedIds.some((id) => typeof id !== 'number')) {
    return NextResponse.json({ error: 'placedIds must be number[]' }, { status: 400 });
  }
  if (
    typeof livesLeft !== 'number' ||
    !Number.isInteger(livesLeft) ||
    livesLeft < 0 ||
    livesLeft > ONLUK_LIVES
  ) {
    return NextResponse.json({ error: 'Invalid livesLeft' }, { status: 400 });
  }
  if (
    typeof streakCorrect !== 'number' ||
    !Number.isInteger(streakCorrect) ||
    streakCorrect < 0 ||
    streakCorrect > 10
  ) {
    return NextResponse.json({ error: 'Invalid streakCorrect' }, { status: 400 });
  }
  if (placedIds.length > ONLUK_SIZE) {
    return NextResponse.json({ error: 'Invalid placedIds length' }, { status: 400 });
  }

  try {
    const result = guessOnluk({
      difficulty,
      date: date ?? getTodayDateString(),
      session,
      playerId,
      placedIds,
      livesLeft,
      streakCorrect,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guess failed';
    if (
      message.includes('already') ||
      message.includes('No lives') ||
      message.includes('complete')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Onluk guess failed:', error);
    return NextResponse.json({ error: 'Guess failed' }, { status: 500 });
  }
}
