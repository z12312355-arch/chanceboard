# Chanceboard 帳號系統部署指南

這個版本使用 Firebase Authentication（帳號登入）與 Cloudflare D1（遊戲資料）。兩者均可使用免費方案；Cloudflare 免費額度達到上限時會停止服務，不會自動產生付費帳單。

## 1. 啟用 Firebase 的 Email/Password 登入

1. 開啟 Firebase Console 的 **Authentication**。
2. 選擇 **Sign-in method**。
3. 點選 **Email/Password**，啟用第一個「Email/Password」開關並儲存。

不需要啟用 Gemini in Firebase，也不需要升級 Blaze 方案。

## 2. 建立 D1 資料庫

1. Cloudflare Dashboard 左側選 **Storage & databases** → **D1 SQL Database** → **Create**。
2. 資料庫名稱輸入 `chanceboard-player-data`。
3. 建立後，開啟該資料庫的 Console／Query 頁面。
4. 開啟本專案的 `database/player-schema.sql`，完整貼入並執行。

## 3. 綁定到 Cloudflare Pages

1. Cloudflare Dashboard → **Workers & Pages** → 選擇 Pages 專案 `chanceboard`。
2. **Settings** → **Bindings** → **Add binding** → 選擇 **D1 database**。
3. Variable name 必須填入 `PLAYER_DB`。
4. 選剛建立的 `chanceboard-player-data`，儲存後重新部署。

## 4. 發布程式

將這些新增檔案與更新後的 `chanceboard.html` 一起 commit、push 到 GitHub 的 `main` 分支。Cloudflare Pages 出現最新 commit 的綠色勾勾後，即代表帳號 API 已部署。

## 注意事項

- 訪客模式仍使用這台裝置的 localStorage；帳號模式資料會依 Firebase UID 分開存在 D1。
- 新帳號會取得三位起始角色（001、004、006）、500 金幣與 30 鑽石。
- 帳號模式的抽卡、商店購卡與每日獎勵會由伺服器驗證並儲存。
- 戰鬥結算的金幣獎勵暫不寫入帳號資料，因為目前戰鬥邏輯全在瀏覽器，不能安全驗證；訪客模式不受影響。
