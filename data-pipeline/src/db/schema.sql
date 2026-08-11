PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS competitions (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  code          TEXT,
  type          TEXT,
  emblem        TEXT,
  area_id       INTEGER,
  area_name     TEXT,
  area_code     TEXT,
  area_flag     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  short_name    TEXT,
  tla           TEXT,
  crest         TEXT,
  address       TEXT,
  website       TEXT,
  founded       INTEGER,
  club_colors   TEXT,
  venue         TEXT,
  area_id       INTEGER,
  area_name     TEXT,
  area_code     TEXT,
  area_flag     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id                INTEGER PRIMARY KEY,
  competition_id    INTEGER NOT NULL,
  start_date        TEXT,
  end_date          TEXT,
  current_matchday  INTEGER,
  winner_team_id    INTEGER,
  stages            TEXT,
  season_year       INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (winner_team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS players (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  name_search     TEXT,
  first_name      TEXT,
  last_name       TEXT,
  date_of_birth   TEXT,
  nationality     TEXT,
  position        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_players_name_search ON players(name_search);

CREATE TABLE IF NOT EXISTS player_season_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       INTEGER NOT NULL,
  team_id         INTEGER NOT NULL,
  season_id       INTEGER NOT NULL,
  competition_id  INTEGER NOT NULL,
  shirt_number    INTEGER,
  market_value    INTEGER,
  appearances     INTEGER DEFAULT 0,
  goals           INTEGER DEFAULT 0,
  assists         INTEGER DEFAULT 0,
  yellow_cards    INTEGER DEFAULT 0,
  red_cards       INTEGER DEFAULT 0,
  minutes_played  INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  UNIQUE(player_id, team_id, season_id, competition_id)
);

CREATE TABLE IF NOT EXISTS transfers (
  id              INTEGER PRIMARY KEY,
  player_id       INTEGER NOT NULL,
  from_team_id    INTEGER,
  to_team_id      INTEGER,
  transfer_date   TEXT,
  transfer_type   TEXT,
  fee_amount      INTEGER,
  fee_currency    TEXT,
  season_year     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (from_team_id) REFERENCES teams(id),
  FOREIGN KEY (to_team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id              INTEGER PRIMARY KEY,
  competition_id  INTEGER NOT NULL,
  season_id       INTEGER NOT NULL,
  utc_date        TEXT,
  status          TEXT,
  matchday        INTEGER,
  stage           TEXT,
  group_name      TEXT,
  home_team_id    INTEGER NOT NULL,
  away_team_id    INTEGER NOT NULL,
  home_score      INTEGER,
  away_score      INTEGER,
  winner          TEXT,
  venue           TEXT,
  attendance      INTEGER,
  minute          INTEGER,
  injury_time     INTEGER,
  last_updated    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (competition_id) REFERENCES competitions(id),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (home_team_id) REFERENCES teams(id),
  FOREIGN KEY (away_team_id) REFERENCES teams(id)
);

-- duration / score breakdown / details_fetched_at added via ensureMatchDetailSchema (ALTER)

CREATE TABLE IF NOT EXISTS match_lineups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL,
  team_id         INTEGER NOT NULL,
  player_id       INTEGER NOT NULL,
  position        TEXT,
  shirt_number    INTEGER,
  is_starter      INTEGER DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE(match_id, team_id, player_id)
);

CREATE TABLE IF NOT EXISTS standings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id       INTEGER NOT NULL,
  team_id         INTEGER NOT NULL,
  position        INTEGER NOT NULL,
  played          INTEGER NOT NULL DEFAULT 0,
  won             INTEGER NOT NULL DEFAULT 0,
  draw            INTEGER NOT NULL DEFAULT 0,
  lost            INTEGER NOT NULL DEFAULT 0,
  points          INTEGER NOT NULL DEFAULT 0,
  goals_for       INTEGER NOT NULL DEFAULT 0,
  goals_against   INTEGER NOT NULL DEFAULT 0,
  stage           TEXT,
  table_type      TEXT DEFAULT 'TOTAL',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (season_id) REFERENCES seasons(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  UNIQUE(season_id, team_id, stage, table_type)
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL DEFAULT 'football-data',
  endpoint        TEXT NOT NULL,
  params_hash     TEXT NOT NULL,
  cache_file      TEXT,
  http_status     INTEGER,
  success         INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seasons_competition ON seasons(competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition_id);
CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
CREATE INDEX IF NOT EXISTS idx_standings_season ON standings(season_id);
CREATE INDEX IF NOT EXISTS idx_fetch_log_endpoint ON fetch_log(endpoint, params_hash);

CREATE TABLE IF NOT EXISTS api_football_fetch_state (
  competition_code TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | partial
  last_page_fetched INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (competition_code, season_year)
);

CREATE TABLE IF NOT EXISTS player_match_log (
  player_id INTEGER,
  match_source TEXT NOT NULL DEFAULT 'api-football-unmatched',
  raw_name TEXT NOT NULL,
  raw_team TEXT NOT NULL,
  matched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- StatPal bulk import
CREATE TABLE IF NOT EXISTS statpal_fetch_state (
  competition_code TEXT NOT NULL,
  season TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (competition_code, season, phase)
);

CREATE TABLE IF NOT EXISTS statpal_fetched_players (
  statpal_player_id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_trophies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  country TEXT,
  league TEXT,
  status TEXT,
  trophy_count INTEGER DEFAULT 0,
  seasons TEXT,
  source TEXT NOT NULL DEFAULT 'statpal',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_teammates (
  player_a_id INTEGER NOT NULL,
  player_b_id INTEGER NOT NULL,
  shared_matches INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_a_id, player_b_id),
  FOREIGN KEY (player_a_id) REFERENCES players(id),
  FOREIGN KEY (player_b_id) REFERENCES players(id),
  CHECK (player_a_id < player_b_id)
);

CREATE INDEX IF NOT EXISTS idx_player_teammates_a ON player_teammates(player_a_id);
CREATE INDEX IF NOT EXISTS idx_player_teammates_b ON player_teammates(player_b_id);
CREATE INDEX IF NOT EXISTS idx_player_trophies_player ON player_trophies(player_id);

CREATE TABLE IF NOT EXISTS daily_puzzles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      TEXT NOT NULL,
  mode_id      TEXT NOT NULL DEFAULT 'general',
  difficulty   TEXT NOT NULL,
  puzzle_date  TEXT NOT NULL,
  session      INTEGER NOT NULL DEFAULT 0,
  puzzle_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, mode_id, difficulty, puzzle_date, session)
);

CREATE INDEX IF NOT EXISTS idx_daily_puzzles_lookup
  ON daily_puzzles(game_id, puzzle_date, difficulty, mode_id);

-- Match detail: in-play goals (incl. penalty goals) from football-data /matches/{id}
CREATE TABLE IF NOT EXISTS match_goals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id           INTEGER NOT NULL,
  team_id            INTEGER NOT NULL,
  scorer_id          INTEGER,
  assist_id          INTEGER,
  minute             INTEGER,
  injury_time        INTEGER,
  goal_type          TEXT NOT NULL, -- REGULAR | PENALTY | OWN_GOAL
  home_score_after   INTEGER,
  away_score_after   INTEGER,
  source             TEXT NOT NULL DEFAULT 'football-data',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (scorer_id) REFERENCES players(id),
  FOREIGN KEY (assist_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_match_goals_match ON match_goals(match_id);
CREATE INDEX IF NOT EXISTS idx_match_goals_type ON match_goals(goal_type);
CREATE INDEX IF NOT EXISTS idx_match_goals_scorer ON match_goals(scorer_id);

-- Penalty shootout kicks (player + scored/missed) from football-data /matches/{id}.penalties
CREATE TABLE IF NOT EXISTS match_penalty_kicks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL,
  team_id         INTEGER,
  player_id       INTEGER,
  kick_order      INTEGER NOT NULL,
  scored          INTEGER NOT NULL, -- 1 = scored, 0 = missed
  source          TEXT NOT NULL DEFAULT 'football-data',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  UNIQUE(match_id, kick_order)
);

CREATE INDEX IF NOT EXISTS idx_penalty_kicks_match ON match_penalty_kicks(match_id);
CREATE INDEX IF NOT EXISTS idx_penalty_kicks_player ON match_penalty_kicks(player_id);
