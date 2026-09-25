import { NextRequest, NextResponse } from 'next/server';

import { createCareerPuzzle } from '@/lib/career-path';
import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'general';
  const difficulty = request.nextUrl.searchParams.get('difficulty') ?? 'medium';
  const dateOrErr = playableDateOrResponse(request.nextUrl.searchParams.get('date'));
  if (dateOrErr instanceof NextResponse) return dateOrErr;
  const date = dateOrErr;
  const sessionRaw = request.nextUrl.searchParams.get('session') ?? '0';
  const session = Number(sessionRaw);

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (!Number.isInteger(session) || session < 0) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const puzzle = createCareerPuzzle(mode, difficulty, date, session);
    return NextResponse.json({
      clubs: puzzle.clubs,
      clubCount: puzzle.clubCount,
      date,
      session,
      mode,
      difficulty,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Puzzle failed';
    if (message.includes('No eligible')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Career path puzzle failed:', error);
    return NextResponse.json({ error: 'Puzzle failed' }, { status: 500 });
  }
}
