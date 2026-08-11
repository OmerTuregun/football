import { NextRequest, NextResponse } from 'next/server';

import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { createOnlukPuzzle, toPublicPuzzle } from '@/lib/onluk';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const difficulty = request.nextUrl.searchParams.get('difficulty') ?? 'easy';
  const date = request.nextUrl.searchParams.get('date') ?? getTodayDateString();
  const sessionRaw = request.nextUrl.searchParams.get('session') ?? '0';
  const session = Number(sessionRaw);

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (!Number.isInteger(session) || session < 0) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const puzzle = createOnlukPuzzle(difficulty, date, session);
    return NextResponse.json(toPublicPuzzle(puzzle, date, session, difficulty));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Puzzle failed';
    if (message.includes('No eligible')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Onluk puzzle failed:', error);
    return NextResponse.json({ error: 'Puzzle failed' }, { status: 500 });
  }
}
