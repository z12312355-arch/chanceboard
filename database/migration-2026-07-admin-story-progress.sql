-- Run once against the production PLAYER_DB D1 database.
-- Environment-variable administrators remain administrators; is_admin adds
-- account-managed administrators without weakening the bootstrap access path.
ALTER TABLE players ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
ALTER TABLE players ADD COLUMN story_progress TEXT;
ALTER TABLE players ADD COLUMN story_stage_progress TEXT;
ALTER TABLE players ADD COLUMN story_discovery TEXT;
