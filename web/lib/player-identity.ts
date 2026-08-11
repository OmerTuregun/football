import 'server-only';

import { getDb } from './db';
import { normalizeForSearch } from './normalize-search';

/**
 * Soft-merge football-data vs StatPal duplicate player rows.
 * Canonical = richest row (statpal_id preferred, then transfer/lineup volume).
 */

interface PlayerIdentityRow {
  id: number;
  name: string;
  name_search: string | null;
  date_of_birth: string | null;
  statpal_id: string | null;
  transfer_count: number;
  lineup_count: number;
}

let toCanonicalCache: Map<number, number> | null = null;
let clusterMembersCache: Map<number, number[]> | null = null;

function richness(row: PlayerIdentityRow): number {
  let score = 0;
  if (row.statpal_id) score += 1_000_000;
  score += row.transfer_count * 100;
  score += row.lineup_count;
  // Prefer accented StatPal spelling slightly when tied
  if (/[šćžđáéíóúñüö]/i.test(row.name)) score += 5;
  return score;
}

function clusterKey(row: PlayerIdentityRow): string | null {
  const ns = (row.name_search ?? normalizeForSearch(row.name)).trim();
  if (!ns) return null;
  const dob = row.date_of_birth?.trim() || '';
  // Require DOB to avoid merging unrelated namesakes
  if (!dob) return `name-only:${ns}#${row.id}`;
  return `${ns}|${dob}`;
}

function buildIdentityMaps(): {
  toCanonical: Map<number, number>;
  members: Map<number, number[]>;
} {
  if (toCanonicalCache && clusterMembersCache) {
    return { toCanonical: toCanonicalCache, members: clusterMembersCache };
  }

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.name_search, p.date_of_birth, p.statpal_id,
              (SELECT COUNT(*) FROM transfers t WHERE t.player_id = p.id) AS transfer_count,
              (SELECT COUNT(*) FROM match_lineups ml WHERE ml.player_id = p.id) AS lineup_count
       FROM players p`
    )
    .all() as PlayerIdentityRow[];

  const groups = new Map<string, PlayerIdentityRow[]>();
  for (const row of rows) {
    const key = clusterKey(row);
    if (!key || key.startsWith('name-only:')) {
      // Singleton — no merge without DOB
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const toCanonical = new Map<number, number>();
  const members = new Map<number, number[]>();

  for (const row of rows) {
    toCanonical.set(row.id, row.id);
    members.set(row.id, [row.id]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => richness(b) - richness(a) || a.id - b.id);
    const canonicalId = group[0].id;
    const ids = group.map((g) => g.id);
    members.set(canonicalId, ids);
    for (const g of group) {
      toCanonical.set(g.id, canonicalId);
      if (g.id !== canonicalId) {
        members.set(g.id, ids);
      }
    }
  }

  toCanonicalCache = toCanonical;
  clusterMembersCache = members;
  return { toCanonical, members };
}

/** Map any player id to its canonical (richest) twin. */
export function resolveCanonicalPlayerId(playerId: number): number {
  return buildIdentityMaps().toCanonical.get(playerId) ?? playerId;
}

/** All ids in the same identity cluster (including self). */
export function getPlayerIdentityCluster(playerId: number): number[] {
  return buildIdentityMaps().members.get(playerId) ?? [playerId];
}

export function clearPlayerIdentityCache(): void {
  toCanonicalCache = null;
  clusterMembersCache = null;
}
