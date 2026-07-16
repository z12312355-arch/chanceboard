-- Run once on an existing PLAYER_DB database.
ALTER TABLE players ADD COLUMN player_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE;

CREATE UNIQUE INDEX IF NOT EXISTS players_player_name_unique
  ON players(player_name COLLATE NOCASE) WHERE player_name <> '';

CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  FOREIGN KEY (user_a) REFERENCES players(uid) ON DELETE CASCADE,
  FOREIGN KEY (user_b) REFERENCES players(uid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS friendships_user_b_idx ON friendships(user_b);
