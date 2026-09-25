import { NextResponse } from 'next/server';

import { resolvePlayablePuzzleDate } from './daily-hash';

/** Returns a playable YYYY-MM-DD, or a 403/400 JSON response. */
export function playableDateOrResponse(
  raw: string | null | undefined
): string | NextResponse {
  const resolved = resolvePlayablePuzzleDate(raw);
  if ('error' in resolved) {
    const status = resolved.error.includes('henüz') ? 403 : 400;
    return NextResponse.json({ error: resolved.error }, { status });
  }
  return resolved.date;
}
