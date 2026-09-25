import { NextRequest, NextResponse } from 'next/server';

import { playableDateOrResponse } from '@/lib/api-playable-date';
import { ONLUK_DIFFICULTY } from '@/lib/onluk-shared';
import { revealOnlukAnswers } from '@/lib/onluk';

export const dynamic = 'force-dynamic';

interface GiveUpBody {
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

  const { date, session = 0 } = body;

  if (typeof session !== 'number' || session < 0 || !Number.isInteger(session)) {
    return NextResponse.json({ error: 'session must be a non-negative integer' }, { status: 400 });
  }

  const dateOrErr = playableDateOrResponse(date);
  if (dateOrErr instanceof NextResponse) return dateOrErr;

  try {
    const result = revealOnlukAnswers(ONLUK_DIFFICULTY, dateOrErr, session);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Onluk give-up failed:', error);
    return NextResponse.json({ error: 'Give-up failed' }, { status: 500 });
  }
}
