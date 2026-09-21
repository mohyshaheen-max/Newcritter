-- One-time migration for the already-live D1 database (adds friend codes + gifting on top of
-- the original leaderboard schema). Run this once in the D1 Console. schema.sql already has
-- these baked into the base CREATE TABLE statements for any future fresh install, so this file
-- is only needed against the existing database.
-- SQLite's ALTER TABLE ADD COLUMN can't carry a UNIQUE constraint directly (rejected outright,
-- nothing partial happens) - add the column plain, then enforce uniqueness with an index instead.
ALTER TABLE players ADD COLUMN friend_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_friend_code ON players(friend_code);

CREATE TABLE IF NOT EXISTS friendships (
  player_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_player ON friendships(player_id);

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
