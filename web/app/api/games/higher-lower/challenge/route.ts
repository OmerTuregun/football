import { NextRequest, NextResponse } from 'next/server';

import { isValidDifficulty } from '@/lib/difficulty-config';
import { isValidGameMode } from '@/lib/game-modes';
import { createChallenge, isValidStatCategory, type StatCategory } from '@/lib/higher-lower';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'general';
  const difficulty = request.nextUrl.searchParams.get('difficulty') ?? 'easy';
  const excludeRaw = request.nextUrl.searchParams.get('excludeId');
  const categoryRaw = request.nextUrl.searchParams.get('category');

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }

  if (!isValidDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty' }, { status: 400 });
  }

  let excludeId: number | undefined;
  if (excludeRaw !== null && excludeRaw !== '') {
    const parsed = Number(excludeRaw);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: 'excludeId must be an integer' }, { status: 400 });
    }
    excludeId = parsed;
  }

  const anchorRaw = request.nextUrl.searchParams.get('anchorId');
  let anchorId: number | undefined;
  if (anchorRaw !== null && anchorRaw !== '') {
    const parsed = Number(anchorRaw);
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: 'anchorId must be an integer' }, { status: 400 });
    }
    anchorId = parsed;
  }

  let category: StatCategory | undefined;
  if (categoryRaw !== null && categoryRaw !== '') {
    if (!isValidStatCategory(categoryRaw)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }
    category = categoryRaw;
  }

  try {
    const challenge = createChallenge(mode, difficulty, excludeId, category, anchorId);
    return NextResponse.json({
      player: challenge.player,
      category: challenge.category,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Challenge failed';
    if (message.includes('No eligible players')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('Higher-lower challenge failed:', error);
    return NextResponse.json({ error: 'Challenge failed' }, { status: 500 });
  }
}
