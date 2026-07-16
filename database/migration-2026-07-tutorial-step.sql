-- One-time migration for resumable tutorial checkpoints.
ALTER TABLE players ADD COLUMN tutorial_step TEXT NOT NULL DEFAULT 'intro';

-- Preserve completed accounts. For unfinished legacy accounts, resume from the
-- safest recoverable stage based on server-owned rewards instead of skipping
-- the tutorial merely because the starter character already exists.
UPDATE players
SET tutorial_step = CASE
  WHEN tutorial_done = 1 THEN 'completed'
  WHEN json_array_length(owned_chars) = 0 THEN 'intro'
  WHEN json_array_length(owned_chars) = 1 THEN 'battle'
  WHEN json_array_length(owned_chars) = 2 THEN 'diamond_summon'
  WHEN json_array_length(teams) > 0 THEN 'ending'
  ELSE 'team'
END;
