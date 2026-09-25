import { NextRequest, NextResponse } from 'next/server';

import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';
import { compareGuess } from '@/lib/players';

export const dynamic = 'force-dynamic';

interface GuessBody {
  playerId?: number;
  mode?: string;
  difficulty?: string;
  date?: string;
  session?: number;
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
    playerId,
    mode = 'general',
    difficulty = 'medium',
    date,
    session = 0,
    attemptNumber,
  } = body;

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }

  if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  if (typeof attemptNumber !== 'number' || attemptNumber < 1 || attemptNumber > 8) {
    return NextResponse.json({ error: 'attemptNumber must be 1–8' }, { status: 400 });
  }

  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  const dateOrErr = playableDateOrResponse(date);
  if (dateOrErr instanceof NextResponse) return dateOrErr;
  const puzzleDate = dateOrErr;

  try {
    const result = compareGuess(playerId, { modeId: mode, difficulty, date: puzzleDate, session }, attemptNumber);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guess failed';
    if (message === 'Player not in mode pool') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Guess comparison failed:', error);
    return NextResponse.json({ error: 'Guess failed' }, { status: 500 });
  }
}
