-- Cloudflare D1 schema. Run this once against the PLAYER_DB database.
CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  gold INTEGER NOT NULL DEFAULT 500 CHECK (gold >= 0),
  diamond INTEGER NOT NULL DEFAULT 30 CHECK (diamond >= 0),
  owned_chars TEXT NOT NULL DEFAULT '[]',
  char_stars TEXT NOT NULL DEFAULT '{}',
  -- 2026-07 升星／培養：願望結晶；move_levels 保存四系技能等級，並以保留鍵保存技能碎片與狩獵派遣；
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
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  story_progress TEXT,
  story_stage_progress TEXT,
  story_discovery TEXT,
  -- 2026-07：加好友用的短碼，8 位數字字串（保留前導零），畫面上顯示成 XXXX-XXXX。
  -- 帳號建立時是空字串，第一次讀取帳號狀態時由 API 端隨機產生並補回（見 ensureFriendCode()）。
  friend_code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2026-07：玩家名字改為可重複（不再要求唯一），加好友改用下面的 friend_code 短碼查詢，
-- 不再用玩家名字或原始 UID。舊資料庫如已建立過 players_player_name_unique，需另外執行
-- migration-2026-07-drop-name-unique.sql 移除該索引。

CREATE UNIQUE INDEX IF NOT EXISTS players_friend_code_unique
  ON players(friend_code) WHERE friend_code <> '';

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
-- See migration-2026-07-admin-story-progress.sql for account-admin and story-progress columns.
-- See migration-2026-07-friend-code.sql for the friend_code column + unique index above.

-- One shared row for live game balance and economy settings.  Player data remains
-- per-account in `players`; this table is deliberately global and admin-only.
CREATE TABLE IF NOT EXISTS game_config (
  config_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
