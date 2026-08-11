import { NextRequest, NextResponse } from 'next/server';

import { revealConnections } from '@/lib/connections';
import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';

export const dynamic = 'force-dynamic';

interface GiveUpBody {
  difficulty?: string;
  date?: string;
  session?: number;
  solvedGroupIds?: string[];
}

export async function POST(request: NextRequest) {
  let body: GiveUpBody;
  try {
    body = (await request.json()) as GiveUpBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { difficulty = 'easy', date, session = 0, solvedGroupIds = [] } = body;

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }
  if (!Array.isArray(solvedGroupIds) || solvedGroupIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'solvedGroupIds must be string[]' }, { status: 400 });
  }

  try {
    const result = revealConnections(
      difficulty,
      date ?? getTodayDateString(),
      session,
      solvedGroupIds
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Connections give-up failed:', error);
    return NextResponse.json({ error: 'Give-up failed' }, { status: 500 });
  }
}
