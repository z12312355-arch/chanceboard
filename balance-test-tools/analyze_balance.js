// 奇蹟之盤 Chanceboard — 強度驗證結果統計腳本（純Node.js，不需要Python）
//
// 用法： node analyze_balance.js [balance_results.jsonl路徑]

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FALLBACK_ROSTER = [
  '詹姆士．弗烈德(James Frida)',
  '羅迪(Rodiy)',
  '緋村 一郎(Himura Ichirou)',
  '圖卡勒絲(Twocolors)',
  '莉莎(Lisa)',
  '大牧',
  '阿京(Okyo)',
  '梅朵．希裴兒(Meytal Cifier)',
  '露露(Ruru)',
  '羽娘',
  '小可(Kochan)',
  '爽子(Sawako)',
  '法蘭克．雷(Frank Thunder)',
  '伊娃伊娃(Ivaiva)',
  '傑．阿爾薩斯(Zed Arthas)',
  '武愛',
  '海瑟(Hesher)',
  '絲妲兒(Stael)',
  '法斯特．伊艾克斯．卡薩巴(First Ex Kasaba)',
  '尼多',
  'R',
];
function loadCurrentRoster(){
  const dbPath = path.join(__dirname, '..', 'chanceboard_db.js');
  try{
    const sandbox = {window:{}};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(dbPath,'utf8'), sandbox, {filename:dbPath});
    const chars = sandbox.window.CHANCEBOARD_DB && sandbox.window.CHANCEBOARD_DB.characters;
    if(Array.isArray(chars) && chars.length) return chars.map(c=>c.name);
  }catch(e){ /* 舊工具包或單獨搬移分析器時，退回內建名單。 */ }
  return FALLBACK_ROSTER;
}
// 名單與索引必須跟目前資料庫順序一致；角色改名後不再需要手動同步分析器。
const ROSTER = loadCurrentRoster();
const IDX2NAME = {}; ROSTER.forEach((n,i)=> IDX2NAME[i+1]=n);

function matchName(raw){
  raw = raw.trim();
  for(const n of ROSTER){
    // 戰鬥紀錄顯示的是去掉英文括號別名後的短名（例如「海瑟」），報表名單則保留
    // 「海瑟(Hesher)」。舊版只拿完整字串比對，導致所有有英文別名的角色都認不出來。
    const shortName = n.replace(/\([^)]*\)/g,'').trim();
    if(raw.includes(n) || (shortName && raw.includes(shortName))) return n;
  }
  return null;
}

const SIDE_LABEL = '(?:黑方|白方|我方|對方|A方|B方)';
const ATTACK_RE = new RegExp('【'+SIDE_LABEL+'】(.+?) 攻擊 【'+SIDE_LABEL+'】(.+?)(?:　💥爆擊)?(?:　🔺屬性相剋)?，造成 (\\d+) 點傷害');
const COUNTER_RE = new RegExp('【'+SIDE_LABEL+'】(.+?) 觸發「還手」，反擊 【'+SIDE_LABEL+'】(.+?)(?:　🔺屬性相剋)?，造成 (\\d+) 點傷害');
const PASSIVE_RE = /(.+?) 的效果對 (.+?) 造成 (\d+) 點傷害/;
const CONFUSE_RE = new RegExp('【'+SIDE_LABEL+'】(.+?) 陷入混亂，攻擊了自己，造成 (\\d+) 點傷害');
// 回血相關的log格式，依「比對優先順序」排列：越具體（能認出施術者）的規則要放前面，
// 不然比較籠統的規則會先比對到同一行的一部分，把施術者的名字誤判成受術者。
// 注意：logText是從畫面元素的.innerText抓出來的，瀏覽器會把<span>之類的HTML標籤全部
// 拿掉、只留下看得到的文字，所以這邊的規則都不用寫HTML標籤，直接比對純文字數字。
const HEAL_CASTER_RE = /(.+?) 的效果為 (.+?) 回復 (\d+) 點血量/; // 有標明施術者：算施術者的回血量
const HEAL_SELF_RE = /(.+?) (?:觸發被動，回復|因未移動觸發被動，回復) (\d+) 點血量/; // 自己回復：算自己
const HEAL_REFLECT_RE = /(.+?) 回復了造成傷害一半的血量：(\d+)/; // 自己回復
const HEAL_REVIVE_RE = /(.+?) 被復活，回復至 (\d+)\/\d+/; // log沒標施術者，只能算在被復活者自己身上
const HEAL_CLEARSTATUS_RE = /(.+?) 解除了全部狀態，回復 (\d+) 點血量/; // 花牌「回復」等清除狀態附帶回血，沒標施術者，算受術者自己
const HEAL_FLAT_RE = /(.+?) 回復 (\d+) 點血量/; // 籠統版本，沒標施術者，算受術者自己（放在最後，避免搶先比對到上面已標施術者的那幾種）

function load(filePath){
  const rows = [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for(const line of lines){
    const t = line.trim();
    if(!t) continue;
    try { rows.push(JSON.parse(t)); } catch(e) { /* skip malformed line */ }
  }
  return rows;
}

function analyze(rows){
  const stats = {};
  ROSTER.forEach(n => stats[n] = {games:0, wins:0, losses:0, draws:0, dmgDealt:0, dmgTaken:0, healDone:0, kills:0, deaths:0});
  let skipped = 0;
  for(const r of rows){
    if(!r.ended || r.winner==null){ skipped++; continue; }
    const Anames = r.A.map(i=>IDX2NAME[i]);
    const Bnames = r.B.map(i=>IDX2NAME[i]);
    const winner = r.winner;
    for(const n of Anames){
      stats[n].games++;
      if(winner==='A') stats[n].wins++;
      else if(winner==='B') stats[n].losses++;
      else stats[n].draws++;
    }
    for(const n of Bnames){
      stats[n].games++;
      if(winner==='B') stats[n].wins++;
      else if(winner==='A') stats[n].losses++;
      else stats[n].draws++;
    }
    const log = r.logText || '';
    for(const line of log.split('\n')){
      let m = ATTACK_RE.exec(line);
      if(m){
        const atkRaw = m[1], defRaw = m[2], dmg = parseInt(m[3],10);
        const died = line.includes('陣亡');
        const atkN = matchName(atkRaw), defN = matchName(defRaw);
        if(atkN){ stats[atkN].dmgDealt += dmg; if(died) stats[atkN].kills++; }
        if(defN){ stats[defN].dmgTaken += dmg; if(died) stats[defN].deaths++; }
        continue;
      }
      m = COUNTER_RE.exec(line);
      if(m){
        const atkN = matchName(m[1]), defN = matchName(m[2]), dmg = parseInt(m[3],10);
        const died = line.includes('陣亡');
        if(atkN){ stats[atkN].dmgDealt += dmg; if(died) stats[atkN].kills++; }
        if(defN){ stats[defN].dmgTaken += dmg; if(died) stats[defN].deaths++; }
        continue;
      }
      m = CONFUSE_RE.exec(line);
      if(m){
        const whoRaw = m[1], dmg = parseInt(m[2],10);
        const died = line.includes('陣亡');
        const whoN = matchName(whoRaw);
        if(whoN){ stats[whoN].dmgTaken += dmg; if(died) stats[whoN].deaths++; }
        continue;
      }
      m = PASSIVE_RE.exec(line);
      if(m){
        const moverRaw = m[1], targetRaw = m[2], dmg = parseInt(m[3],10);
        const moverN = matchName(moverRaw), targetN = matchName(targetRaw);
        const died = line.includes('陣亡');
        if(moverN){ stats[moverN].dmgDealt += dmg; if(died) stats[moverN].kills++; }
        if(targetN){ stats[targetN].dmgTaken += dmg; if(died) stats[targetN].deaths++; }
        continue;
      }
      // 回血：依優先順序比對（有標明施術者的先比對，避免被籠統版本搶先吃掉）
      m = HEAL_CASTER_RE.exec(line);
      if(m){
        const casterN = matchName(m[1]);
        if(casterN) stats[casterN].healDone += parseInt(m[3],10);
        continue;
      }
      m = HEAL_SELF_RE.exec(line);
      if(m){
        const n = matchName(m[1]);
        if(n) stats[n].healDone += parseInt(m[2],10);
        continue;
      }
      m = HEAL_REFLECT_RE.exec(line);
      if(m){
        const n = matchName(m[1]);
        if(n) stats[n].healDone += parseInt(m[2],10);
        continue;
      }
      m = HEAL_REVIVE_RE.exec(line);
      if(m){
        const n = matchName(m[1]);
        if(n) stats[n].healDone += parseInt(m[2],10);
        continue;
      }
      m = HEAL_CLEARSTATUS_RE.exec(line);
      if(m){
        const n = matchName(m[1]);
        if(n) stats[n].healDone += parseInt(m[2],10);
        continue;
      }
      m = HEAL_FLAT_RE.exec(line);
      if(m){
        const n = matchName(m[1]);
        if(n) stats[n].healDone += parseInt(m[2],10);
      }
    }
  }
  return {stats, skipped};
}

// 終端機的等寬字體通常把中文字當成2個英文字元寬，混合中英文名字用單純的
// .length去排版會對不齊，所以這邊自己算「顯示寬度」（中日韓全形字算2，
// 其他算1）再手動補空白，終端機裡的表格才會真的對齊。
function displayWidth(str){
  let w = 0;
  for(const ch of String(str)){
    const code = ch.codePointAt(0);
    const isWide = (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x3FFFD);
    w += isWide ? 2 : 1;
  }
  return w;
}
function padEndVisual(s, n){ s = String(s); return s + ' '.repeat(Math.max(0, n - displayWidth(s))); }
function padStartVisual(s, n){ s = String(s); return ' '.repeat(Math.max(0, n - displayWidth(s))) + s; }

const filePath = process.argv[2] || 'balance_results.jsonl';
const rows = load(filePath);
const {stats, skipped} = analyze(rows);
console.log(`total rows loaded: ${rows.length}, skipped (not ended/no winner): ${skipped}`);
console.log();

const rowsOut = ROSTER.map(n => {
  const s = stats[n];
  const decisive = s.wins + s.losses;
  const wr = decisive ? (s.wins/decisive*100) : NaN;
  const dpg = s.games ? s.dmgDealt/s.games : 0;
  const tpg = s.games ? s.dmgTaken/s.games : 0;
  const hpg = s.games ? s.healDone/s.games : 0;
  return {n, g:s.games, w:s.wins, l:s.losses, d:s.draws, wr, dpg, tpg, hpg, k:s.kills, dth:s.deaths};
});
rowsOut.sort((a,b) => {
  const av = isNaN(a.wr) ? -1 : a.wr, bv = isNaN(b.wr) ? -1 : b.wr;
  return bv - av;
});

console.log(
  padEndVisual('角色',24)+padStartVisual('場次',6)+padStartVisual('勝',5)+padStartVisual('敗',5)+
  padStartVisual('和',4)+padStartVisual('勝率%',8)+padStartVisual('場均輸出',10)+padStartVisual('場均承傷',10)+
  padStartVisual('場均回血',10)+padStartVisual('KO',5)+padStartVisual('陣亡',5)
);
for(const r of rowsOut){
  const wrS = isNaN(r.wr) ? 'n/a' : r.wr.toFixed(1);
  console.log(
    padEndVisual(r.n,24)+padStartVisual(r.g,6)+padStartVisual(r.w,5)+padStartVisual(r.l,5)+
    padStartVisual(r.d,4)+padStartVisual(wrS,8)+padStartVisual(r.dpg.toFixed(2),10)+padStartVisual(r.tpg.toFixed(2),10)+
    padStartVisual(r.hpg.toFixed(2),10)+padStartVisual(r.k,5)+padStartVisual(r.dth,5)
  );
}

// 另外輸出一份HTML報表——不管終端機字體或視窗寬度如何，用瀏覽器打開一定
// 是整整齊齊的表格，比終端機裡的純文字表格更好讀。
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
const htmlRows = rowsOut.map(r => {
  const wrS = isNaN(r.wr) ? 'n/a' : r.wr.toFixed(1)+'%';
  const wrClass = isNaN(r.wr) ? '' : (r.wr>=55 ? 'strong' : r.wr<=45 ? 'weak' : '');
  return `<tr class="${wrClass}"><td class="name">${escapeHtml(r.n)}</td><td>${r.g}</td><td>${r.w}</td><td>${r.l}</td><td>${r.d}</td><td class="wr">${wrS}</td><td>${r.dpg.toFixed(2)}</td><td>${r.tpg.toFixed(2)}</td><td>${r.hpg.toFixed(2)}</td><td>${r.k}</td><td>${r.dth}</td></tr>`;
}).join('\n');
const htmlOut = `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="UTF-8"><title>奇蹟之盤 強度驗證報表</title>
<style>
  body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;background:#12141c;color:#e8e9f0;padding:24px;}
  h1{font-size:20px;}
  .meta{color:#8a8fa3;font-size:13px;margin-bottom:16px;}
  table{border-collapse:collapse;width:100%;max-width:960px;}
  th,td{padding:6px 10px;text-align:right;border-bottom:1px solid #333850;font-size:14px;}
  th{color:#8a8fa3;font-weight:normal;border-bottom:2px solid #4da3ff;}
  td.name{text-align:left;font-weight:bold;}
  td.wr{font-weight:bold;}
  tr.strong td.wr{color:#e05555;}
  tr.weak td.wr{color:#4caf50;}
  tr:hover{background:#1c1f2b;}
</style></head>
<body>
<h1>奇蹟之盤 Chanceboard — 強度驗證報表</h1>
<div class="meta">總場次：${rows.length}　略過（未結束/無勝負）：${skipped}　　<span style="color:#e05555">紅字＝勝率≥55%（偏強）</span>　<span style="color:#4caf50">綠字＝勝率≤45%（偏弱）</span></div>
<table>
<tr><th style="text-align:left">角色</th><th>場次</th><th>勝</th><th>敗</th><th>和</th><th>勝率%</th><th>場均輸出</th><th>場均承傷</th><th>場均回血</th><th>KO</th><th>陣亡</th></tr>
${htmlRows}
</table>
</body></html>`;
const outHtmlPath = path.join(path.dirname(filePath), 'balance_report.html');
fs.writeFileSync(outHtmlPath, htmlOut);
console.log();
console.log('已另外產生更好讀的HTML報表：' + outHtmlPath + '　（用瀏覽器打開即可）');
