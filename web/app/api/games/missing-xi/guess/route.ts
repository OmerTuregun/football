import { NextRequest, NextResponse } from 'next/server';

import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';
import { guessMissingXiSlot, MAX_SLOT_ATTEMPTS } from '@/lib/missing-xi';

export const dynamic = 'force-dynamic';

interface GuessBody {
  mode?: string;
  difficulty?: string;
  date?: string;
  session?: number;
  slotIndex?: number;
  guess?: string;
  attemptNumber?: number;
}

export async function POST(request: NextRequest) {
  let body: GuessBody;
  try {
    body = (await request.json()) as GuessBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    mode = 'general',
    difficulty = 'medium',
    date,
    session = 0,
    slotIndex,
    guess,
    attemptNumber,
  } = body;

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof slotIndex !== 'number' || !Number.isInteger(slotIndex)) {
    return NextResponse.json({ error: 'slotIndex is required' }, { status: 400 });
  }
  if (typeof guess !== 'string' || guess.trim().length === 0) {
    return NextResponse.json({ error: 'guess is required' }, { status: 400 });
  }
  if (
    typeof attemptNumber !== 'number' ||
    attemptNumber < 1 ||
    attemptNumber > MAX_SLOT_ATTEMPTS
  ) {
    return NextResponse.json(
      { error: `attemptNumber must be 1–${MAX_SLOT_ATTEMPTS}` },
      { status: 400 }
    );
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  const dateOrErr = playableDateOrResponse(date);
  if (dateOrErr instanceof NextResponse) return dateOrErr;

  try {
    const result = guessMissingXiSlot({
      modeId: mode,
      difficulty,
      date: dateOrErr,
      session,
      slotIndex,
      guess,
      attemptNumber,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guess failed';
    if (
      message.includes('Guess must be') ||
      message.includes('Invalid') ||
      message.includes('length')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Missing XI guess failed:', error);
    return NextResponse.json({ error: 'Guess failed' }, { status: 500 });
  }
}
