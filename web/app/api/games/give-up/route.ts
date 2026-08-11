import { NextRequest, NextResponse } from 'next/server';

import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';
import { revealDailyPlayer } from '@/lib/players';

export const dynamic = 'force-dynamic';

interface GiveUpBody {
  mode?: string;
  difficulty?: string;
  date?: string;
  session?: number;
}

export async function POST(request: NextRequest) {
  let body: GiveUpBody;

  try {
    body = (await request.json()) as GiveUpBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mode = 'general', difficulty = 'medium', date, session = 0 } = body;

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }

  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  const puzzleDate = date ?? getTodayDateString();

  try {
    const revealed = revealDailyPlayer({
      modeId: mode,
      difficulty,
      date: puzzleDate,
      session,
    });
    return NextResponse.json({ revealed, gameOver: true });
  } catch (error) {
    console.error('Give up reveal failed:', error);
    return NextResponse.json({ error: 'Reveal failed' }, { status: 500 });
  }
}
