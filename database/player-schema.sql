-- Cloudflare D1 schema. Run this once against the PLAYER_DB database.
CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  gold INTEGER NOT NULL DEFAULT 500 CHECK (gold >= 0),
  diamond INTEGER NOT NULL DEFAULT 30 CHECK (diamond >= 0),
  owned_chars TEXT NOT NULL DEFAULT '[]',
  char_stars TEXT NOT NULL DEFAULT '{}',
  -- 2026-07 升星改制：滿星溢出補償的願望結晶；招式技能等級（劍/槍/法 LV1-5，升級素材未開放，先預留）；
  -- stars_version=1 代表 char_stars 已是新制（1..5 星），舊資料由 API 端一次性遷移（見 [[path]].js）。
  wish_crystals INTEGER NOT NULL DEFAULT 0 CHECK (wish_crystals >= 0),
  move_levels TEXT NOT NULL DEFAULT '{}',
  stars_version INTEGER NOT NULL DEFAULT 1,
  owned_cards TEXT NOT NULL DEFAULT '{}',
  teams TEXT NOT NULL DEFAULT '[]',
  tutorial_done INTEGER NOT NULL DEFAULT 0,
  tutorial_step TEXT NOT NULL DEFAULT 'intro',
  tutorial_faction TEXT NOT NULL DEFAULT 'black',
  lobby_hero_id TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  daily_bonus_date TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

-- Existing databases need this one-time migration before rerunning the indexes/tables above:
-- ALTER TABLE players ADD COLUMN player_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE;

-- One shared row for live game balance and economy settings.  Player data remains
-- per-account in `players`; this table is deliberately global and admin-only.
CREATE TABLE IF NOT EXISTS game_config (
  config_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
