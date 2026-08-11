import { NextRequest, NextResponse } from 'next/server';

import { getTodayDateString } from '@/lib/daily-hash';
import { isValidDifficulty } from '@/lib/difficulty-config';
import { revealOnlukAnswers } from '@/lib/onluk';

export const dynamic = 'force-dynamic';

interface GiveUpBody {
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

  const { difficulty = 'easy', date, session = 0 } = body;

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }
  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  try {
    const result = revealOnlukAnswers(
      difficulty,
      date ?? getTodayDateString(),
      session
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Onluk give-up failed:', error);
    return NextResponse.json({ error: 'Give-up failed' }, { status: 500 });
  }
}
