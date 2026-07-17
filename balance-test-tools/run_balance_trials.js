// 奇蹟之盤 Chanceboard — 強度驗證批次腳本
//
// 用法：
//   node run_balance_trials.js [場次] [並行分頁數] [遊戲html路徑]
//   例如： node run_balance_trials.js 360 8 ../chanceboard.html
//
// 需要先安裝依賴（第一次使用時）：
//   npm install playwright
//   npx playwright install chromium
//
// 每場隨機從21位角色裡各挑3人組成黑方／白方，全自動跑完戰鬥，結果會即時
// 附加寫入 balance_results.jsonl（可用 analyze_balance.js 統計勝率）。
//
// 自己調整角色數值後怎麼驗證（不用再跟我要新檔案）：
//   1. 打開你要驗證的那份game html（可以直接用你在玩的 chanceboard.html），
//      從後臺（admin panel）編輯角色／招式數值，按「套用」。
//   2. 按後臺的「下載完整遊戲檔案」，存成一個新的html（例如 chanceboard_v2.html），
//      放在隨便你想放的地方。
//   3. 跑： node run_balance_trials.js 360 8 你剛剛存的那個檔案路徑
//   這是因為戰鬥模擬用的技術性入口已經直接寫進遊戲主程式碼裡，不是外掛的，
//   所以任何從後臺重新匯出的新檔案都自動繼續可以用這支腳本驗證，不需要
//   特製的測試版檔案。（如果指到的是2026年7月這次更新之前匯出的舊檔案，
//   會因為缺少這個入口而報錯，屆時要用新版本重新匯出一次。）
//
// 2026-07 更新（第二版）：遊戲改版加了登入畫面／大廳／「隊伍」清單這一整套新流程。
// 第一版嘗試直接呼叫遊戲內部的 state／startGame()／shuffle 等函式/變數繞過畫面，結果
// 全部噴 ReferenceError——整份遊戲程式碼包在最上層一個大IIFE裡（見chanceboard.html自己
// 的註解「只存在IIFE closure裡的函式，全域根本找不到」），只有明確掛在 window 上的東西
// （window.__runFastBattle／window.__isEnded）能從外面呼叫到，其餘一律不能直接引用，只能
// 透過真正的DOM點擊（.click()）去觸發已經綁定好的事件處理器（跟這支腳本改版前的做法一樣，
// 這點沒有變，變的只是新版畫面需要點的按鈕/流程不同了）。
//
// 所以這版改成：
//   1. 用 page.addInitScript() 在頁面自己的程式碼開始跑之前，把「已組好的隊伍清單」
//      （chanceboard_teams_v1）跟「新手教學已完成」（chanceboard_tutorial_done_v1）
//      這兩把 localStorage 鑰匙預先寫好——隊伍清單直接在Node這邊用真正的角色/卡片id
//      隨機組出一批（見 buildTeamPool()，資料來源是 chanceboard_db.js，跟遊戲本身
//      優先讀取外部資料庫的邏輯一致），這樣完全不用經過「選角色→組卡組→存隊伍」那幾個
//      畫面（也就不用管螢幕上roster-grid有沒有把每個角色都列出來、要不要先抽卡解鎖等
//      跟自動化批次測試無關的門檻）；教學旗標則是避免全新存檔第一次點「進入遊戲」時
//      跳進新手教學互動劇情，卡住整個自動化流程。
//   2. 之後只需要真正點擊：登入畫面「進入遊戲」→大廳「雙人對戰」→挑隊伍畫面選兩支
//      隊伍→「開始遊戲」，戰鬥畫面出現後呼叫 window.__runFastBattle() 瞬間跑完整場，
//      再點「再玩一局」（會直接回到同一個挑隊伍畫面，隊伍清單還在，不用重新登入/回大廳）
//      進下一場，同一個分頁可以連續跑很多場，不用每場都重新載入整個頁面。

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

/* ============ 從 Node 端直接讀角色/卡片資料（不經過瀏覽器） ============
   遊戲本身的 DB／CHAR_BY_ID／CARD_BY_ID 這些變數都關在上面說明的IIFE裡，瀏覽器端的
   page.evaluate() 完全碰不到，所以改成在Node這邊直接讀 chanceboard_db.js（跟遊戲
   實際在玩時優先讀取的是同一份檔案），拿到真正的角色id/卡片id列表，用來在Node端
   組出隨機隊伍，再透過localStorage預先塞給頁面。 */
function parseDbJsFile(dbPath){
  const src = fs.readFileSync(dbPath, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: dbPath });
  if(!sandbox.window.CHANCEBOARD_DB) throw new Error('讀不到 window.CHANCEBOARD_DB，檔案格式可能不對：'+dbPath);
  return sandbox.window.CHANCEBOARD_DB;
}
// 備援：如果目標game html旁邊沒有 chanceboard_db.js（例如指到單獨搬走的匯出檔案），
// 改成直接從那份html裡把內建快照 EMBEDDED_DB 那一整行抓出來解析（跟 exportFullGameFile()
// 匯出時把DB整個塞進那一行是同一個格式：一整行「const EMBEDDED_DB = {...};」）。
function extractEmbeddedDbFromHtml(gameFile){
  const lines = fs.readFileSync(gameFile, 'utf8').split('\n');
  const prefix = 'const EMBEDDED_DB = ';
  for(const line of lines){
    if(line.startsWith(prefix)){
      let jsonText = line.slice(prefix.length).trim();
      if(jsonText.endsWith(';')) jsonText = jsonText.slice(0, -1);
      return JSON.parse(jsonText);
    }
  }
  return null;
}
function loadGameDB(gameFile){
  const dbPath = path.join(path.dirname(gameFile), 'chanceboard_db.js');
  if(fs.existsSync(dbPath)) return parseDbJsFile(dbPath);
  const embedded = extractEmbeddedDbFromHtml(gameFile);
  if(embedded) return embedded;
  throw new Error(
    `找不到角色/卡片資料：${path.dirname(gameFile)} 底下沒有 chanceboard_db.js，這份game html裡的\n`+
    `內建快照(EMBEDDED_DB)也讀不到。請確認game html旁邊有放 chanceboard_db.js，或指向的是一份用\n`+
    `後臺「下載完整遊戲檔案」匯出的完整game html。`
  );
}

function shuffleArr(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// 隨機組一批隊伍（每支3名角色＋10張卡的隨機卡組），存進遊戲「隊伍」清單格式，直接透過
// localStorage預先塞給頁面（見下面 page.addInitScript()），不需要真的在畫面上點選角色/
// 組卡組——跟玩家自己在「隊伍」畫面手動組、存起來的資料格式完全一樣（characterIds＋
// deck這兩個欄位，deck是「卡片id -> 張數」的物件，見chanceboard.html的confirmDeckBuild()/
// expandDeckDraft()），只是這裡换成程式碼直接生成，開戰前才不用一直重複走那幾個畫面。
function buildTeamPool(charIds, cardIds, size){
  const teams = [];
  for(let i=0;i<size;i++){
    const chars = shuffleArr(charIds.slice()).slice(0,3);
    const deck = {};
    for(let k=0;k<10;k++){ const cid = pickRandom(cardIds); deck[cid] = (deck[cid]||0)+1; }
    teams.push({ id: 'team_'+i, name: '隊伍'+(i+1), characterIds: chars, deck });
  }
  return teams;
}

const OUT_FILE = process.env.OUT_FILE || path.join(__dirname, 'balance_results.jsonl');
const POOL_SIZE = 30; // 預先組多少支隨機隊伍給每個分頁重複配對用，數字越大配對組合越多樣

async function runBatch(file, n, concurrency, teamPool, idxOf) {
  const browser = await chromium.launch();
  const results = [];
  let idx = 0;
  const teamIds = teamPool.map(t => t.id);

  async function setupPage() {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('dialog', d => { d.dismiss().catch(()=>{}); }); // 保險：擋掉每日簽到的alert彈窗，避免卡住
    // 在頁面本身的程式碼開始執行之前，先把隊伍清單／教學完成旗標寫進localStorage，
    // 詳見檔案最上面的說明。
    await page.addInitScript((teamsData) => {
      try {
        localStorage.setItem('chanceboard_teams_v1', JSON.stringify(teamsData));
        localStorage.setItem('chanceboard_tutorial_done_v1', '1');
      } catch(e) { /* 存取失敗就算了，等等在畫面上會很明顯看得出來（沒有隊伍可選） */ }
    }, teamPool);
    await page.goto('file://' + path.resolve(file));

    const hasHook = await page.evaluate(() => typeof window.__runFastBattle === 'function');
    if(!hasHook){
      await page.close();
      throw new Error(
        `這個檔案沒有戰鬥模擬用的入口（__runFastBattle），沒辦法用這支腳本跑批次。\n` +
        `檔案路徑：${path.resolve(file)}\n` +
        `可能原因：這是2026年7月更新之前匯出的舊版遊戲檔案。請打開這份game html的後臺，\n` +
        `按「下載完整遊戲檔案」重新匯出一次新版本，再把腳本指向新匯出的那個檔案。`
      );
    }

    // 本機 file:// 批次不需要等待 Firebase 帳號服務；新版登入介面會在驗證服務初始化期間把
    // 按鈕設為 disabled，而離線測試可能永遠等不到它解鎖。測試已預先寫入完整訪客資料，這裡
    // 暫時解除 disabled 並觸發既有登入 handler，直接以訪客身分進入大廳。
    await page.evaluate(() => {
      const enter = document.getElementById('loginEnterBtn');
      enter.disabled = false;
      enter.click();
    });
    // 雙人對戰入口已從玩家大廳隱藏、移到後臺，但測試仍需要用雙方都由程式控制的模式跑平衡。
    // Playwright 的 page.click() 會強制等待元素「可見」，因此對 hidden 按鈕必然逾時；改成在頁面
    // 內直接觸發 DOM click，照常執行既有 goToTeamPick('two') handler，且不依賴按鈕是否顯示。
    await page.evaluate(() => document.getElementById('lobbyTwoBtn').click());
    // 現在停在「挑隊伍」畫面，兩欄（黑方／白方）已經列出上面預先塞好的隊伍清單。
    return { page, errors };
  }

  async function playOneGame(page, errors) {
    const teamIdA = pickRandom(teamIds);
    let teamIdB = pickRandom(teamIds);
    // 允許黑白方挑到同一支隊伍互打鏡像局（遊戲本身支援、原本舊版腳本也沒特別排除同角色
    // 對打的情況），這裡只是單純各自獨立隨機挑一支，不強求一定要不同支。

    await page.click(`#teampick-body .teampick-col:nth-child(1) .teampick-card[data-team-id="${teamIdA}"]`);
    await page.click(`#teampick-body .teampick-col:nth-child(2) .teampick-card[data-team-id="${teamIdB}"]`);
    await page.click('#teampickConfirmBtn');

    const result = await page.evaluate(() => {
      const battleResult = window.__runFastBattle();
      // 新版測試入口直接回傳 state.winner，避免結算畫面改版後再靠顯示文字猜勝方而失準。
      // 舊版匯出檔若還沒有 winner 欄位，才退回原本的文字判斷以維持相容。
      let winner = battleResult.winner || null, endText = null, logText = null;
      if(battleResult.ended){
        endText = document.getElementById('endscreen') ? document.getElementById('endscreen').textContent : '';
        if (!winner && endText.includes('黑方獲勝')) winner = 'A';
        else if (!winner && endText.includes('白方獲勝')) winner = 'B';
        else if (!winner && endText.includes('平手')) winner = 'draw';
        logText = document.getElementById('log') ? document.getElementById('log').innerText : '';
      }
      return { battleResult, winner, endText, logText };
    });

    const teamA = teamPool.find(t => t.id === teamIdA);
    const teamB = teamPool.find(t => t.id === teamIdB);
    const A = teamA.characterIds.map(id => idxOf[id]);
    const B = teamB.characterIds.map(id => idxOf[id]);
    const r = { A, B, ended: result.battleResult.ended, winner: result.winner, iters: result.battleResult.iters, errors: errors.slice(), logText: result.logText };
    errors.length = 0;

    // 回到同一個挑隊伍畫面繼續下一場（隊伍清單還在，不用重新登入/回大廳）。
    await page.click('#restartBtn2');
    return r;
  }

  async function worker() {
    const { page, errors } = await setupPage();
    while (idx < n) {
      const myIdx = idx++;
      const r = await playOneGame(page, errors);
      results.push(r);
      fs.appendFileSync(OUT_FILE, JSON.stringify(r) + '\n');
      process.stdout.write(`[#${myIdx}/${n}] A=${r.A} B=${r.B} winner=${r.winner} ended=${r.ended} errors=${r.errors.length}\n`);
    }
    await page.close();
  }

  const workers = Array.from({length: concurrency}, () => worker());
  await Promise.all(workers);
  await browser.close();
  return results;
}

(async () => {
  const N = parseInt(process.argv[2] || '20', 10);
  const CONC = parseInt(process.argv[3] || '4', 10);
  // 沒帶路徑參數時，預設直接指向上一層資料夾的正式版 chanceboard.html（你實際在玩、
  // 用後臺編輯數值的那一份），這樣改完數值不用額外指路徑，直接跑就是驗證最新版本。
  // 如果那個位置找不到檔案（例如整個資料夾被搬走了），才退回用這個工具包內建的快照
  // 副本 miracleboard_testharness.html 當備援，並提醒一下這份可能不是最新資料。
  const defaultRealGame = [
    path.join(__dirname, '..', 'chanceboard.html'),
    path.join(__dirname, '..', 'index.html')
  ].find(fs.existsSync);
  const defaultFallback = path.join(__dirname, 'miracleboard_testharness.html');
  let file = process.argv[4];
  if(!file){
    if(defaultRealGame){
      file = defaultRealGame;
    } else {
      file = defaultFallback;
      console.log(`（找不到上一層的 chanceboard.html 或 index.html，改用工具包內建的快照副本 ${defaultFallback}，這份資料可能不是最新的，建議直接帶路徑參數指向你目前的正式版game html。）`);
    }
  }

  let teamPool, idxOf;
  try {
    const DB = loadGameDB(file);
    const charIds = DB.characters.map(c => c.id);
    const cardIds = DB.cards.map(c => c.id); // 跟遊戲內DECKBUILD_CARD_IDS（花色卡+花牌卡）同一份
    idxOf = {}; charIds.forEach((id,i)=> idxOf[id]=i+1); // 1-based，對應ROSTER／analyze_balance.js的順序
    teamPool = buildTeamPool(charIds, cardIds, POOL_SIZE);
  } catch(e) {
    console.error('\n讀取角色/卡片資料時發生錯誤：\n' + e.message + '\n');
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, '');
  const t0 = Date.now();
  let results;
  try {
    results = await runBatch(file, N, CONC, teamPool, idxOf);
  } catch(e) {
    console.error('\n跑批次時發生錯誤：\n' + e.message + '\n');
    process.exit(1);
  }
  const elapsed = (Date.now()-t0)/1000;
  const errs = results.reduce((s,r)=>s+r.errors.length,0);
  const notEnded = results.filter(r=>!r.ended).length;
  console.log('=== DONE ===  trials:', results.length, 'not-ended:', notEnded, 'total errors:', errs, 'elapsed:', elapsed.toFixed(1)+'s', 'per-game avg:', (elapsed/results.length).toFixed(3)+'s');
  console.log('結果已寫入：', OUT_FILE);
  console.log('接著可以跑： node analyze_balance.js ' + path.basename(OUT_FILE));
})();
