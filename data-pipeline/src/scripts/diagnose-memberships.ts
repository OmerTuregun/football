import Database from 'better-sqlite3';
import { DB_PATH } from '../config';

const db = new Database(DB_PATH, { readonly: true });

const ec = db.prepare('SELECT id FROM competitions WHERE code = ?').get('EC') as { id: number } | undefined;
const wc = db.prepare('SELECT id FROM competitions WHERE code = ?').get('WC') as { id: number } | undefined;

console.log('EC competition id:', ec?.id);
console.log('WC competition id:', wc?.id);

if (ec) {
  const seasons = db
    .prepare('SELECT id, season_year FROM seasons WHERE competition_id = ? ORDER BY season_year')
    .all(ec.id);
  console.log('EC seasons:', seasons);

  const pss = db
    .prepare('SELECT COUNT(*) AS c FROM player_season_stats WHERE competition_id = ?')
    .get(ec.id) as { c: number };
  console.log('EC player_season_stats rows:', pss.c);
}

if (wc) {
  const pss = db
    .prepare('SELECT COUNT(*) AS c FROM player_season_stats WHERE competition_id = ?')
    .get(wc.id) as { c: number };
  console.log('WC player_season_stats rows:', pss.c);
}

db.close();
