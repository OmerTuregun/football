import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DB_PATH, ensureDirs } from '../config';
import { normalizeForSearch } from '../utils/normalizeSearch';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    ensureDirs();
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function ensurePlayerNameSearchColumn(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(players)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'name_search')) {
    db.exec('ALTER TABLE players ADD COLUMN name_search TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_players_name_search ON players(name_search)');

  const rows = db
    .prepare('SELECT id, name, name_search FROM players')
    .all() as { id: number; name: string; name_search: string | null }[];

  const pending = rows.filter(
    (row) => normalizeForSearch(row.name) !== (row.name_search ?? '')
  );
  if (pending.length === 0) return;

  const update = db.prepare('UPDATE players SET name_search = ? WHERE id = ?');
  const backfill = db.transaction(
    (items: { id: number; name: string; name_search: string | null }[]) => {
      for (const row of items) {
        update.run(normalizeForSearch(row.name), row.id);
      }
    }
  );
  backfill(pending);
  console.log(`[db] Rebuilt name_search for ${pending.length} players`);
}

export function runMigrations(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const db = getDb();

  const playersTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'players'")
    .get();
  if (playersTable) {
    ensurePlayerNameSearchColumn(db);
  }

  // Add new columns before schema.sql indexes that may reference them
  ensureMatchDetailSchema(db);
  db.exec(schema);
  ensurePlayerNameSearchColumn(db);
  ensureStatPalSchema(db);
  ensureMatchDetailSchema(db);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function ensureStatPalSchema(db: Database.Database): void {
  addColumnIfMissing(db, 'teams', 'statpal_id', 'statpal_id TEXT');
  addColumnIfMissing(db, 'players', 'statpal_id', 'statpal_id TEXT');
  addColumnIfMissing(db, 'players', 'market_value_eur', 'market_value_eur INTEGER');
  addColumnIfMissing(db, 'matches', 'statpal_id', 'statpal_id TEXT');
  addColumnIfMissing(db, 'transfers', 'price', 'price TEXT');
  addColumnIfMissing(db, 'transfers', 'from_team_name', 'from_team_name TEXT');
  addColumnIfMissing(db, 'transfers', 'to_team_name', 'to_team_name TEXT');
  addColumnIfMissing(db, 'transfers', 'statpal_from_id', 'statpal_from_id TEXT');
  addColumnIfMissing(db, 'transfers', 'statpal_to_id', 'statpal_to_id TEXT');

  const pssCols = [
    ['key_passes', 'INTEGER'],
    ['pass_attempts', 'INTEGER'],
    ['pass_success', 'INTEGER'],
    ['tackles', 'INTEGER'],
    ['duels_total', 'INTEGER'],
    ['duels_won', 'INTEGER'],
    ['dribble_attempts', 'INTEGER'],
    ['dribble_success', 'INTEGER'],
    ['rating', 'REAL'],
    ['starting_lineups', 'INTEGER'],
    ['substitute_in', 'INTEGER'],
    ['stat_source', 'TEXT'],
    ['statpal_league_id', 'TEXT'],
    ['statpal_season', 'TEXT'],
  ] as const;
  for (const [col, typ] of pssCols) {
    addColumnIfMissing(db, 'player_season_stats', col, `${col} ${typ}`);
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_statpal_id ON teams(statpal_id) WHERE statpal_id IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_statpal_id ON players(statpal_id) WHERE statpal_id IS NOT NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_statpal_id ON matches(statpal_id) WHERE statpal_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_transfers_player_id ON transfers(player_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_match_lineups_player_id ON match_lineups(player_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_match_lineups_team_id ON match_lineups(team_id)');
}

function ensureMatchDetailSchema(db: Database.Database): void {
  const matchCols = [
    ['duration', 'TEXT'],
    ['regular_home', 'INTEGER'],
    ['regular_away', 'INTEGER'],
    ['extra_home', 'INTEGER'],
    ['extra_away', 'INTEGER'],
    ['penalty_home', 'INTEGER'],
    ['penalty_away', 'INTEGER'],
    ['details_fetched_at', 'TEXT'],
  ] as const;
  for (const [col, typ] of matchCols) {
    addColumnIfMissing(db, 'matches', col, `${col} ${typ}`);
  }

  const hasGoals = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_goals'")
    .get();
  const hasKicks = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_penalty_kicks'")
    .get();

  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='matches'").get()) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_matches_duration ON matches(duration)');
  }
  if (hasGoals) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_match_goals_match ON match_goals(match_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_match_goals_type ON match_goals(goal_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_match_goals_scorer ON match_goals(scorer_id)');
  }
  if (hasKicks) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_penalty_kicks_match ON match_penalty_kicks(match_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_penalty_kicks_player ON match_penalty_kicks(player_id)');
  }
}
