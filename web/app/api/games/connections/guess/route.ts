import { NextRequest, NextResponse } from 'next/server';

import { guessConnections } from '@/lib/connections';
import {
  CONNECTIONS_GROUP_SIZE,
  CONNECTIONS_MISTAKES,
} from '@/lib/connections-shared';
import { playableDateOrResponse } from '@/lib/api-playable-date';
import { isValidDifficulty } from '@/lib/difficulty-config';

export const dynamic = 'force-dynamic';

interface GuessBody {
  difficulty?: string;
  date?: string;
  session?: number;
  playerIds?: number[];
  solvedGroupIds?: string[];
  mistakesLeft?: number;
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
    playerIds = [],
    solvedGroupIds = [],
    mistakesLeft = CONNECTIONS_MISTAKES,
  } = body;

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }
  if (
    !Array.isArray(playerIds) ||
    playerIds.length !== CONNECTIONS_GROUP_SIZE ||
    playerIds.some((id) => typeof id !== 'number' || !Number.isInteger(id))
  ) {
    return NextResponse.json({ error: 'playerIds must be 4 integers' }, { status: 400 });
  }
  if (!Array.isArray(solvedGroupIds) || solvedGroupIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'solvedGroupIds must be string[]' }, { status: 400 });
  }
  if (
    typeof mistakesLeft !== 'number' ||
    !Number.isInteger(mistakesLeft) ||
    mistakesLeft < 0 ||
    mistakesLeft > CONNECTIONS_MISTAKES
  ) {
    return NextResponse.json({ error: 'Invalid mistakesLeft' }, { status: 400 });
  }

  const dateOrErr = playableDateOrResponse(date);
  if (dateOrErr instanceof NextResponse) return dateOrErr;

  try {
    const result = guessConnections({
      difficulty,
      date: dateOrErr,
      session,
      playerIds,
      solvedGroupIds,
      mistakesLeft,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Guess failed';
    if (
      message.includes('exactly 4') ||
      message.includes('Duplicate') ||
      message.includes('No mistakes')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Connections guess failed:', error);
    return NextResponse.json({ error: 'Guess failed' }, { status: 500 });
  }
}
