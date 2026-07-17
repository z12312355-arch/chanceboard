-- 2026-07 升星改制 一次性 schema migration（既有的 PLAYER_DB 執行一次即可；新建資料庫直接跑
-- player-schema.sql 就已包含這些欄位，不用再跑這份）。
--
-- 內容：
--   wish_crystals：願望結晶（滿星後再抽到重複的補償，可幫其他角色升星）。
--   move_levels  ：招式技能等級（劍/槍/法 LV1-5；升級素材尚未開放，先預留欄位）。
--   stars_version：0=舊制星級（0..5，抽到=0星）、1=新制（1..5，抽到=1星）。
--                  既有玩家保持預設0，玩家下次連線時由 API 端自動做「全部+1星、
--                  舊滿星溢出換願望結晶」的一次性資料遷移（見 [[path]].js 的 migrateStarsToV2）。
ALTER TABLE players ADD COLUMN wish_crystals INTEGER NOT NULL DEFAULT 0 CHECK (wish_crystals >= 0);
ALTER TABLE players ADD COLUMN move_levels TEXT NOT NULL DEFAULT '{}';
ALTER TABLE players ADD COLUMN stars_version INTEGER NOT NULL DEFAULT 0;
