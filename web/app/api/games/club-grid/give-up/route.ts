import { NextRequest, NextResponse } from 'next/server';

import { revealClubGrid } from '@/lib/club-grid';
import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';

export const dynamic = 'force-dynamic';

interface Body {
  mode?: string;
  difficulty?: string;
  date?: string;
  session?: number;
  usedPlayerIds?: number[];
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    mode = 'general',
    difficulty = 'easy',
    date,
    session = 0,
    usedPlayerIds = [],
  } = body;

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }
  if (!Array.isArray(usedPlayerIds) || usedPlayerIds.some((id) => typeof id !== 'number')) {
    return NextResponse.json({ error: 'usedPlayerIds must be number[]' }, { status: 400 });
  }

  const dateOrErr = playableDateOrResponse(date);
  if (dateOrErr instanceof NextResponse) return dateOrErr;

  try {
    const result = revealClubGrid({
      modeId: mode,
      difficulty,
      date: dateOrErr,
      session,
      usedPlayerIds,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Club grid reveal failed:', error);
    return NextResponse.json({ error: 'Reveal failed' }, { status: 500 });
  }
}
