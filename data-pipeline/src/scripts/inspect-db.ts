import Database from 'better-sqlite3';
import { DB_PATH } from '../config';

const db = new Database(DB_PATH, { readonly: true });

console.log(`DB: ${DB_PATH}\n`);

console.log('TEAMS SAMPLE:');
console.table(
  db.prepare('SELECT id, name, short_name, tla FROM teams LIMIT 5').all()
);

console.log('MATCHES SAMPLE:');
console.table(
  db
    .prepare(
      `SELECT id, matchday, stage, home_team_id, away_team_id, home_score, away_score, status
       FROM matches ORDER BY utc_date LIMIT 5`
    )
    .all()
);

console.log('STANDINGS SAMPLE:');
console.table(
  db
    .prepare(
      `SELECT position, team_id, played, won, draw, lost, points, table_type
       FROM standings ORDER BY table_type, position LIMIT 10`
    )
    .all()
);

db.close();
