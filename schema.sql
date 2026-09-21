CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
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
