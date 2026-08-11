import Database from 'better-sqlite3';
import { DB_PATH } from '../config';
import { parseArgs } from '../utils';

const db = new Database(DB_PATH, { readonly: true });

console.log(`DB: ${DB_PATH}\n`);

console.log('standings per season:');
console.table(
  db
    .prepare(
      `SELECT s.season_year, st.season_id, COUNT(*) AS cnt
       FROM standings st
       JOIN seasons s ON s.id = st.season_id
       GROUP BY st.season_id
       ORDER BY s.season_year`
    )
    .all()
);

console.log('matches per season:');
console.table(
  db
    .prepare(
      `SELECT s.season_year, m.season_id, COUNT(*) AS cnt
       FROM matches m
       JOIN seasons s ON s.id = m.season_id
       GROUP BY m.season_id
       ORDER BY s.season_year`
    )
    .all()
);

const args = parseArgs(process.argv.slice(2));
const seasonYears = (args['season-years'] ?? '2024,2025')
  .split(',')
  .map((y) => parseInt(y.trim(), 10))
  .filter((y) => !Number.isNaN(y));

const seasonIdStmt = db.prepare('SELECT id, season_year FROM seasons WHERE season_year = ?');

for (const year of seasonYears) {
  const season = seasonIdStmt.get(year) as { id: number; season_year: number } | undefined;
  if (!season) {
    console.log(`\n${year} AWAY top5: (no season row for year ${year})`);
    continue;
  }
  console.log(`\n${year} AWAY top5 (season_id=${season.id}):`);
  console.table(
    db
      .prepare(
        `SELECT position, team_id, points
         FROM standings
         WHERE season_id = ? AND table_type = 'AWAY'
         ORDER BY position
         LIMIT 5`
      )
      .all(season.id)
  );
}

db.close();
