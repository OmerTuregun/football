import { NextRequest, NextResponse } from 'next/server';

import { isValidGameMode } from '@/lib/game-modes';
import { searchPlayers } from '@/lib/players';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  const mode = request.nextUrl.searchParams.get('mode') ?? 'general';
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitRaw ?? '8', 10) || 8, 1), 20);

  if (!isValidGameMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }

  try {
    const players = searchPlayers(q, mode, limit);
    return NextResponse.json(
      { players },
      {
        headers: {
          // Short private cache: repeated typing of same prefix feels instant
          'Cache-Control': 'private, max-age=30',
        },
      }
    );
  } catch (error) {
    console.error('Player search failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
