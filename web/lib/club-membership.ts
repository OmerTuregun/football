import 'server-only';

import {
  CANONICAL_CLUBS,
  canonicalClubKey,
  getCanonicalClub,
} from './club-canonical';
import { getDb } from './db';
import { resolveCanonicalPlayerId } from './player-identity';

export type ClubPlayerSet = Set<number>;

let membershipCache: Map<string, ClubPlayerSet> | null = null;
let crestCache: Map<string, string | null> | null = null;

function ensureMembership(): Map<string, ClubPlayerSet> {
  if (membershipCache) return membershipCache;

  const db = getDb();
  const map = new Map<string, ClubPlayerSet>();

  const add = (playerId: number, clubKey: string | null): void => {
    if (!clubKey || !playerId) return;
    const canonicalId = resolveCanonicalPlayerId(playerId);
    let set = map.get(clubKey);
    if (!set) {
      set = new Set();
      map.set(clubKey, set);
    }
    set.add(canonicalId);
  };

  const transferRows = db
    .prepare(
      `SELECT t.player_id,
              tf.name AS from_name,
              tt.name AS to_name,
              t.from_team_name,
              t.to_team_name
       FROM transfers t
       LEFT JOIN teams tf ON tf.id = t.from_team_id
       LEFT JOIN teams tt ON tt.id = t.to_team_id`
    )
    .all() as Array<{
    player_id: number;
    from_name: string | null;
    to_name: string | null;
    from_team_name: string | null;
    to_team_name: string | null;
  }>;

  for (const row of transferRows) {
    add(row.player_id, canonicalClubKey(row.from_name ?? ''));
    add(row.player_id, canonicalClubKey(row.to_name ?? ''));
    add(row.player_id, canonicalClubKey(row.from_team_name ?? ''));
    add(row.player_id, canonicalClubKey(row.to_team_name ?? ''));
  }

  const lineupRows = db
    .prepare(
      `SELECT ml.player_id, t.name
       FROM match_lineups ml
       JOIN teams t ON t.id = ml.team_id`
    )
    .all() as Array<{ player_id: number; name: string }>;

  for (const row of lineupRows) {
    add(row.player_id, canonicalClubKey(row.name));
  }

  const seasonRows = db
    .prepare(
      `SELECT pss.player_id, t.name
       FROM player_season_stats pss
       JOIN teams t ON t.id = pss.team_id`
    )
    .all() as Array<{ player_id: number; name: string }>;

  for (const row of seasonRows) {
    add(row.player_id, canonicalClubKey(row.name));
  }

  membershipCache = map;
  return map;
}

function ensureCrests(): Map<string, string | null> {
  if (crestCache) return crestCache;

  const db = getDb();
  const teams = db
    .prepare(
      `SELECT name, crest FROM teams
       WHERE crest IS NOT NULL AND trim(crest) != ''
       ORDER BY CASE WHEN statpal_id IS NULL THEN 0 ELSE 1 END, id`
    )
    .all() as Array<{ name: string; crest: string }>;

  const map = new Map<string, string | null>();

  for (const club of CANONICAL_CLUBS) {
    const needles = [...(club.crestNeedles ?? []), ...club.needles, club.label.toLowerCase()];
    let found: string | null = null;
    for (const team of teams) {
      const key = team.name.normalize('NFC').toLocaleLowerCase('tr-TR');
      if (needles.some((n) => key.includes(n.toLowerCase()))) {
        if (club.key === 'arsenal' && (key.includes('tula') || key.includes('tivat'))) continue;
        if (club.key === 'psg' && key.includes('paris fc')) continue;
        found = team.crest;
        break;
      }
    }
    map.set(club.key, found);
  }

  crestCache = map;
  return map;
}

export function getClubMembership(clubKey: string): ClubPlayerSet {
  return ensureMembership().get(clubKey) ?? new Set();
}

export function getClubMembershipMap(): Map<string, ClubPlayerSet> {
  return ensureMembership();
}

export function playersForBothClubs(rowKey: string, colKey: string): number[] {
  const a = getClubMembership(rowKey);
  const b = getClubMembership(colKey);
  const out: number[] = [];
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  for (const id of small) {
    if (large.has(id)) out.push(id);
  }
  return out;
}

export function clubHasPlayer(clubKey: string, playerId: number): boolean {
  const canonicalId = resolveCanonicalPlayerId(playerId);
  return getClubMembership(clubKey).has(canonicalId);
}

export function getClubCrest(clubKey: string): string | null {
  return ensureCrests().get(clubKey) ?? null;
}

export function getClubLabel(clubKey: string): string {
  return getCanonicalClub(clubKey)?.label ?? clubKey;
}

export function clearClubMembershipCache(): void {
  membershipCache = null;
  crestCache = null;
}
