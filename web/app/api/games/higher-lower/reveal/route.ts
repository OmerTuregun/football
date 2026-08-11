import { NextRequest, NextResponse } from 'next/server';

import {
  isValidGuess,
  isValidStatCategory,
  revealChallenge,
  revealPlayerStat,
} from '@/lib/higher-lower';

export const dynamic = 'force-dynamic';

interface RevealBody {
  /** Bootstrap: reveal only this player's value (reference card at round start). */
  playerId?: number;
  referenceId?: number;
  challengerId?: number;
  category?: string;
  guess?: string;
}

export async function POST(request: NextRequest) {
  let body: RevealBody;

  try {
    body = (await request.json()) as RevealBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { playerId, referenceId, challengerId, category, guess } = body;

  if (!category || !isValidStatCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  }

  try {
    // Bootstrap: show reference value before the first guess.
    if (typeof playerId === 'number' && Number.isInteger(playerId) && guess === undefined) {
      const value = revealPlayerStat(playerId, category);
      return NextResponse.json({ value, category });
    }

    if (
      typeof referenceId !== 'number' ||
      !Number.isInteger(referenceId) ||
      typeof challengerId !== 'number' ||
      !Number.isInteger(challengerId)
    ) {
      return NextResponse.json(
        { error: 'referenceId and challengerId are required' },
        { status: 400 }
      );
    }

    if (!guess || !isValidGuess(guess)) {
      return NextResponse.json({ error: 'guess must be higher or lower' }, { status: 400 });
    }

    const result = revealChallenge({
      referenceId,
      challengerId,
      category,
      guess,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reveal failed';
    if (message.includes('unavailable')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Higher-lower reveal failed:', error);
    return NextResponse.json({ error: 'Reveal failed' }, { status: 500 });
  }
}
