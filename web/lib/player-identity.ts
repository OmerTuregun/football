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
  if (/[šćžđáéíóúñüö]/i.test(row.name)) score += 5;
  if (row.date_of_birth?.trim()) score += 10;
  return score;
}

function nameSearch(row: PlayerIdentityRow): string {
  return (row.name_search ?? normalizeForSearch(row.name)).trim();
}

function lastNameToken(nameSearch: string): string {
  const parts = nameSearch.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : nameSearch;
}

function sortedNameKey(nameSearch: string): string {
  return nameSearch.split(/\s+/).filter(Boolean).sort().join(' ');
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  find(id: number): number {
    let root = id;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let node = id;
    while (this.parent.has(node) && this.parent.get(node) !== node) {
      const next = this.parent.get(node)!;
      this.parent.set(node, root);
      node = next;
    }
    if (!this.parent.has(root)) this.parent.set(root, root);
    return root;
  }

  unite(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
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

  const uf = new UnionFind();
  for (const row of rows) uf.find(row.id);

  const keyToId = new Map<string, number>();
  for (const row of rows) {
    const ns = nameSearch(row);
    if (!ns) continue;
    const dob = row.date_of_birth?.trim() || '';
    if (!dob) continue;

    for (const key of [
      `last:${lastNameToken(ns)}|${dob}`,
      `full:${sortedNameKey(ns)}|${dob}`,
    ]) {
      const existing = keyToId.get(key);
      if (existing !== undefined) uf.unite(row.id, existing);
      else keyToId.set(key, row.id);
    }
  }

  const withDobBySorted = new Map<string, PlayerIdentityRow[]>();
  for (const row of rows) {
    const dob = row.date_of_birth?.trim();
    if (!dob) continue;
    const sorted = sortedNameKey(nameSearch(row));
    const list = withDobBySorted.get(sorted) ?? [];
    list.push(row);
    withDobBySorted.set(sorted, list);
  }

  for (const row of rows) {
    if (row.date_of_birth?.trim()) continue;
    const sorted = sortedNameKey(nameSearch(row));
    if (!sorted) continue;
    const matches = withDobBySorted.get(sorted) ?? [];
    if (matches.length === 1) uf.unite(row.id, matches[0]!.id);
  }

  const components = new Map<number, PlayerIdentityRow[]>();
  for (const row of rows) {
    const root = uf.find(row.id);
    const list = components.get(root) ?? [];
    list.push(row);
    components.set(root, list);
  }

  const toCanonical = new Map<number, number>();
  const members = new Map<number, number[]>();

  for (const group of components.values()) {
    group.sort((a, b) => richness(b) - richness(a) || a.id - b.id);
    const canonicalId = group[0]!.id;
    const ids = group.map((g) => g.id);
    members.set(canonicalId, ids);
    for (const g of group) {
      toCanonical.set(g.id, canonicalId);
      if (g.id !== canonicalId) members.set(g.id, ids);
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
