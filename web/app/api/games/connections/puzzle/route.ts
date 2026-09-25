import { NextRequest, NextResponse } from 'next/server';

import {
  createConnectionsPuzzle,
  toPublicConnectionsPuzzle,
} from '@/lib/connections';
import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const difficulty = request.nextUrl.searchParams.get('difficulty') ?? 'easy';
  const dateOrErr = playableDateOrResponse(request.nextUrl.searchParams.get('date'));
  if (dateOrErr instanceof NextResponse) return dateOrErr;
  const date = dateOrErr;
  const sessionRaw = request.nextUrl.searchParams.get('session') ?? '0';
  const session = Number(sessionRaw);

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (!Number.isInteger(session) || session < 0) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const puzzle = createConnectionsPuzzle(difficulty, date, session);
    return NextResponse.json(toPublicConnectionsPuzzle(puzzle, date, session, difficulty));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Puzzle failed';
    if (message.includes('No eligible') || message.includes('Could not assemble')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Connections puzzle failed:', error);
    return NextResponse.json({ error: 'Puzzle failed' }, { status: 500 });
  }
}
