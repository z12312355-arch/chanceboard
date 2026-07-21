-- Run once on an existing PLAYER_DB database that already applied
-- migration-2026-07-player-name-friends.sql.
-- 2026-07：玩家名字改為可重複，不再要求唯一；加好友一律改用 UID，
-- 所以不再需要靠名字唯一索引來反查玩家。
DROP INDEX IF EXISTS players_player_name_unique;
