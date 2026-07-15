-- Cloudflare D1 schema. Run this once against the PLAYER_DB database.
CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  gold INTEGER NOT NULL DEFAULT 500 CHECK (gold >= 0),
  diamond INTEGER NOT NULL DEFAULT 30 CHECK (diamond >= 0),
  owned_chars TEXT NOT NULL DEFAULT '[]',
  char_stars TEXT NOT NULL DEFAULT '{}',
  owned_cards TEXT NOT NULL DEFAULT '{}',
  teams TEXT NOT NULL DEFAULT '[]',
  tutorial_done INTEGER NOT NULL DEFAULT 0,
  tutorial_faction TEXT NOT NULL DEFAULT 'black',
  lobby_hero_id TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  daily_bonus_date TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
