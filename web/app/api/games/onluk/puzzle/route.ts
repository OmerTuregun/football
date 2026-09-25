import { NextRequest, NextResponse } from 'next/server';

import { playableDateOrResponse } from '@/lib/api-playable-date';
import { ONLUK_DIFFICULTY } from '@/lib/onluk-shared';
import { createOnlukPuzzle, toPublicPuzzle } from '@/lib/onluk';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const dateOrErr = playableDateOrResponse(request.nextUrl.searchParams.get('date'));
  if (dateOrErr instanceof NextResponse) return dateOrErr;
  const date = dateOrErr;
  const sessionRaw = request.nextUrl.searchParams.get('session') ?? '0';
  const session = Number(sessionRaw);

  if (!Number.isInteger(session) || session < 0) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const puzzle = createOnlukPuzzle(ONLUK_DIFFICULTY, date, session);
    return NextResponse.json(toPublicPuzzle(puzzle, date, session));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Puzzle failed';
    if (message.includes('No eligible')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Onluk puzzle failed:', error);
    return NextResponse.json({ error: 'Puzzle failed' }, { status: 500 });
  }
}
