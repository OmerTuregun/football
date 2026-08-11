import { NextRequest, NextResponse } from 'next/server';

import { guessClubGridCell, GRID_SIZE } from '@/lib/club-grid';
import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';

export const dynamic = 'force-dynamic';

interface GuessBody {
  mode?: string;
  difficulty?: string;
  date?: string;
  session?: number;
  row?: number;
  col?: number;
  playerId?: number;
  usedPlayerIds?: number[];
  solvedCount?: number;
  openCells?: Array<{ row: number; col: number }>;
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
    difficulty = 'easy',
    date,
    session = 0,
    row,
    col,
    playerId,
    usedPlayerIds = [],
    solvedCount = 0,
    openCells = [],
  } = body;

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof row !== 'number' || typeof col !== 'number') {
    return NextResponse.json({ error: 'row and col are required' }, { status: 400 });
  }
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    return NextResponse.json({ error: 'Invalid cell' }, { status: 400 });
  }
  if (typeof playerId !== 'number' || !Number.isInteger(playerId)) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }
  if (!Array.isArray(usedPlayerIds) || usedPlayerIds.some((id) => typeof id !== 'number')) {
    return NextResponse.json({ error: 'usedPlayerIds must be number[]' }, { status: 400 });
  }
  if (typeof solvedCount !== 'number' || solvedCount < 0 || solvedCount > GRID_SIZE * GRID_SIZE) {
    return NextResponse.json({ error: 'Invalid solvedCount' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const result = guessClubGridCell({
      modeId: mode,
      difficulty,
      date: date ?? getTodayDateString(),
      session,
      row,
      col,
      playerId,
      usedPlayerIds,
      solvedCount,
      openCells,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guess failed';
    if (
      message.includes('already used') ||
      message.includes('not found') ||
      message.includes('Invalid')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Club grid guess failed:', error);
    return NextResponse.json({ error: 'Guess failed' }, { status: 500 });
  }
}
