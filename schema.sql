CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  friend_code TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_scores (
  player_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, week_id)
);
CREATE INDEX IF NOT EXISTS idx_weekly_scores_week ON weekly_scores(week_id, stars DESC);

CREATE TABLE IF NOT EXISTS reward_claims (
  player_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  coins_awarded INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, week_id)
);

-- Symmetric: adding a friend via their code inserts both (A,B) and (B,A) in one batch, so
-- "my friends" is always a plain lookup on player_id with no join direction to worry about.
CREATE TABLE IF NOT EXISTS friendships (
  player_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_player ON friendships(player_id);

-- One row per (sender, recipient, week) - the unique index is what enforces "one gift per
-- friend per week" per direction; mutual gifting in the same week is still two separate rows.
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_player_id TEXT NOT NULL,
  to_player_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  coins INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gifts_unique_pair_week ON gifts(from_player_id, to_player_id, week_id);
CREATE INDEX IF NOT EXISTS idx_gifts_to_player ON gifts(to_player_id, claimed);
