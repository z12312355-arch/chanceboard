-- Run once on an existing PLAYER_DB database.
-- 2026-07：加好友用短碼取代原始 Firebase UID（UID 太長不好手動輸入/分享）。
-- 短碼是 8 位數字字串，畫面上顯示成 XXXX-XXXX；既有玩家的短碼由 API 端
-- 第一次讀取帳號狀態時自動補上（見 [[path]].js 的 ensureFriendCode()），
-- 這裡只需要先把欄位與唯一索引建好。
ALTER TABLE players ADD COLUMN friend_code TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS players_friend_code_unique
  ON players(friend_code) WHERE friend_code <> '';
