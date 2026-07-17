/*
 * Secure account API for Cloudflare Pages Functions + D1.
 * Firebase Auth identifies the player; inventory and currency live only in D1.
 */
const FIREBASE_API_KEY = 'AIzaSyBGg5KcXJmiQGCdCnEQ_hn4knulcemyKhY';
const GOLD_START = 500, DIAMOND_START = 30;
const FLOWER_CARD_IDS = Array.from({ length: 22 }, (_, i) => String(i + 5).padStart(3, '0'));
const ALL_CHARACTER_IDS = Array.from({ length: 21 }, (_, i) => String(i + 1).padStart(3, '0'));
const DIAMOND_EXCLUSIVE_IDS = new Set(['016', '014', '003', '021', '018', '020']);
const TUTORIAL_STEPS = ['intro', 'starter', 'battle', 'gold_summon', 'diamond_summon', 'team', 'ending', 'completed'];
const SKILL_SLOTS = ['劍', '槍', '法', '願'];
const HUNT_DURATION_MS = 30 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function apiError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
async function requireUser(request) {
  const idToken = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) throw apiError('Please sign in first.', 401);
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  const payload = await response.json().catch(() => ({}));
  const user = payload.users && payload.users[0];
  if (!response.ok || !user || !user.localId) throw apiError('Your sign-in session has expired. Please sign in again.', 401);
  return { uid: user.localId, email: user.email || '' };
}
function todayUtc() { return new Date().toISOString().slice(0, 10); }
function parseJson(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function intInRange(value, fallback, min = 0, max = 999999999) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function isAdminUser(env, user) {
  const csv = value => String(env[value] || '').split(',').map(v => v.trim()).filter(Boolean);
  return csv('ADMIN_UIDS').includes(user.uid) || csv('ADMIN_EMAILS').map(v => v.toLowerCase()).includes(user.email.toLowerCase());
}
function defaultGlobalConfig() {
  return {
    balanceVersion: 2,
    characters: null, moves: null, cards: null,
    introStory: {
      black: ['哈哈，歡迎加入黑方，我是小黑。', '對了，你叫什麼？', '……原來如此。', '從今天開始，我就叫你『{name}』了。', '可別太早死啊。'],
      white: ['歡迎加入白方，我是小白。', '在開始旅程之前。', '請告訴我你的名字。', '{name}。', '我記住了。', '希望有一天，大家都能記住這個名字。']
    },
    settings: {
      dailyGold: 200, dailyDiamond: 5,
      goldGachaOneCost: 100, goldGachaTenCost: 1000,
      diamondGachaOneCost: 10, diamondGachaTenCost: 100
    }
  };
}
function normalizeGlobalConfig(input) {
  const fallback = defaultGlobalConfig();
  const source = input && typeof input === 'object' ? input : {};
  // Rows saved before the 2026-07 stat/power rework have no version. Keep them
  // identifiable as v1 so the client does not overwrite the new bundled combat
  // data with the old small-number character/move/card snapshot.
  const balanceVersion = Number.isInteger(Number(source.balanceVersion)) ? Number(source.balanceVersion) : 1;
  const list = (key, max) => Array.isArray(source[key]) && source[key].length <= max ? source[key] : null;
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const introFallback = fallback.introStory;
  const introSource = source.introStory && typeof source.introStory === 'object' ? source.introStory : {};
  const storyLines = key => Array.isArray(introSource[key]) && introSource[key].length >= 2 && introSource[key].length <= 20
    ? introSource[key].map(line => String(line).slice(0, 300)) : introFallback[key];
  const tutorialSource = source.tutorialStory && typeof source.tutorialStory === 'object' ? source.tutorialStory : null;
  const tutorialSideKeys = ['pickIntro','afterPick','goldIntro','goldOffer','afterGold','diamondIntro','diamondOffer','afterDiamond','teamIntro','teamPick3','teamDeck','afterTeam','battleIntro','battlePickTeam','afterBattleWin','afterBattleLose','returnLobby','ending'];
  let tutorialStory = null;
  if (tutorialSource) {
    tutorialStory = {};
    if (Array.isArray(tutorialSource.prologue) && tutorialSource.prologue.length >= 1 && tutorialSource.prologue.length <= 50) {
      tutorialStory.prologue = tutorialSource.prologue.map(line => String(line).slice(0, 500));
    }
    if (tutorialSource.greeting && typeof tutorialSource.greeting === 'object') {
      tutorialStory.greeting = {};
      ['black','white'].forEach(side => {
        const lines = tutorialSource.greeting[side];
        if (Array.isArray(lines) && lines.length >= 2 && lines.length <= 20) tutorialStory.greeting[side] = lines.map(line => String(line).slice(0, 500));
      });
    }
    tutorialSideKeys.forEach(key => {
      const pair = tutorialSource[key];
      if (!pair || typeof pair !== 'object') return;
      tutorialStory[key] = {};
      ['black','white'].forEach(side => { if (typeof pair[side] === 'string') tutorialStory[key][side] = pair[side].slice(0, 2000); });
    });
    if (typeof tutorialSource.endingNote === 'string') tutorialStory.endingNote = tutorialSource.endingNote.slice(0, 1000);
  }
  return {
    balanceVersion,
    characters: list('characters', 100), moves: list('moves', 500), cards: list('cards', 200),
    introStory: { black: storyLines('black'), white: storyLines('white') },
    tutorialStory,
    settings: {
      dailyGold: intInRange(settings.dailyGold, fallback.settings.dailyGold),
      dailyDiamond: intInRange(settings.dailyDiamond, fallback.settings.dailyDiamond),
      goldGachaOneCost: intInRange(settings.goldGachaOneCost, fallback.settings.goldGachaOneCost, 1),
      goldGachaTenCost: intInRange(settings.goldGachaTenCost, fallback.settings.goldGachaTenCost, 1),
      diamondGachaOneCost: intInRange(settings.diamondGachaOneCost, fallback.settings.diamondGachaOneCost, 1),
      diamondGachaTenCost: intInRange(settings.diamondGachaTenCost, fallback.settings.diamondGachaTenCost, 1)
    }
  };
}
async function getGlobalConfig(db) {
  // Existing deployments keep working until the one-time schema migration is run.
  // In that period gameplay uses the built-in defaults, while only global admin save
  // is unavailable instead of every account endpoint failing.
  try {
    const row = await db.prepare('SELECT value FROM game_config WHERE config_key=?1').bind('live').first();
    return normalizeGlobalConfig(parseJson(row && row.value, defaultGlobalConfig()));
  } catch (_) {
    return defaultGlobalConfig();
  }
}
async function saveGlobalConfig(db, config) {
  const normalized = normalizeGlobalConfig(config);
  await db.prepare('INSERT INTO game_config (config_key,value,updated_at) VALUES (?1,?2,unixepoch()) ON CONFLICT(config_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .bind('live', JSON.stringify(normalized)).run();
  return normalized;
}
function weightedPick(items, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * total;
  for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll < 0) return items[i]; }
  return items[items.length - 1];
}
function configuredGachaPick(config, currency, excluded = []) {
  const characters = Array.isArray(config.characters) ? config.characters : [];
  const allowed = (currency === 'diamond' ? ALL_CHARACTER_IDS : ALL_CHARACTER_IDS.filter(id => !DIAMOND_EXCLUSIVE_IDS.has(id))).filter(id => !excluded.includes(id));
  const byId = new Map(characters.map(c => [String(c && c.id), c]));
  const items = allowed.length ? allowed : (currency === 'diamond' ? ALL_CHARACTER_IDS : ALL_CHARACTER_IDS.filter(id => !DIAMOND_EXCLUSIVE_IDS.has(id)));
  const weights = items.map(id => Math.max(0, Number(byId.get(id) && byId.get(id).gachaWeight) || 1));
  return weightedPick(items, weights.some(w => w > 0) ? weights : items.map(() => 1));
}
function configuredCardPrice(config, cardId) {
  const card = Array.isArray(config.cards) ? config.cards.find(c => String(c && c.id) === cardId) : null;
  return intInRange(card && card.shopPrice, 150, 0);
}
// move_levels 原本已是玩家進度欄位。碎片與狩獵使用保留鍵一起存放，避免既有 D1
// 還需要額外 ALTER TABLE；對前端仍拆成 moveLevels / skillFragments / huntState。
function progressionFromRow(row) {
  const raw = parseJson(row.move_levels, {});
  const levels = {};
  for (const [key, value] of Object.entries(safeObject(raw))) {
    if (!key.startsWith('__') && ALL_CHARACTER_IDS.includes(key) && value && typeof value === 'object') levels[key] = value;
  }
  const fragments = {};
  SKILL_SLOTS.forEach(slot => { fragments[slot] = intInRange(raw.__fragments && raw.__fragments[slot], 0); });
  return { raw, levels, fragments, hunt: raw.__hunt && typeof raw.__hunt === 'object' ? raw.__hunt : null };
}
function packedProgression(levels, fragments, hunt) {
  const out = {};
  for (const [charId, perChar] of Object.entries(safeObject(levels))) {
    if (!ALL_CHARACTER_IDS.includes(charId)) continue;
    const cleaned = {};
    SKILL_SLOTS.forEach(slot => { if (perChar && perChar[slot] != null) cleaned[slot] = intInRange(perChar[slot], 1, 1, 5); });
    if (Object.keys(cleaned).length) out[charId] = cleaned;
  }
  out.__fragments = {};
  SKILL_SLOTS.forEach(slot => { out.__fragments[slot] = intInRange(fragments && fragments[slot], 0); });
  if (hunt) out.__hunt = hunt;
  return out;
}
function profileFromRow(row) {
  const progression = progressionFromRow(row);
  return {
    playerName: row.player_name || '',
    gold: row.gold, diamond: row.diamond,
    ownedCharIds: parseJson(row.owned_chars, []), charStars: parseJson(row.char_stars, {}),
    // 2026-07 升星改制：願望結晶餘額與（預留的）招式技能等級。
    wishCrystals: Number(row.wish_crystals) || 0, moveLevels: progression.levels,
    skillFragments: progression.fragments, huntState: progression.hunt,
    ownedCardCounts: parseJson(row.owned_cards, {}), teams: parseJson(row.teams, []),
    tutorialDone: !!row.tutorial_done, tutorialStep: tutorialStepFromRow(row), tutorialFaction: row.tutorial_faction || 'black',
    lobbyHeroId: row.lobby_hero_id || null, settings: parseJson(row.settings, {}),
    dailyBonusDate: row.daily_bonus_date || ''
  };
}
async function ensureProfile(db, user) {
  // A new account begins with no inventory. Tutorial grants are handled below,
  // one time only, rather than trusting the browser to add characters.
  // stars_version=1：新帳號直接用新制星級（1..5），不需要遷移。
  await db.prepare(`INSERT OR IGNORE INTO players
    (uid,email,player_name,gold,diamond,owned_chars,char_stars,wish_crystals,move_levels,stars_version,owned_cards,teams,tutorial_done,tutorial_faction,lobby_hero_id,settings,daily_bonus_date,created_at,updated_at)
    VALUES (?1,?2,'',?3,?4,'[]','{}',0,'{}',1,'{}','[]',0,'black',NULL,'{}','',unixepoch(),unixepoch())`)
    .bind(user.uid, user.email, GOLD_START, DIAMOND_START).run();
  return db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
}
// 2026-07 升星改制的一次性資料遷移：舊制（抽到=0星、滿星=5星）→ 新制（抽到=1星、滿星=5星）
// ＝全部+1星，實際加成不變（舊N星+5%×N ＝ 新N+1星+5%×N，前端倍率公式改為 (星級-1)×5%）；
// 舊滿星5星多出來的那一星轉成願望結晶。stars_version 欄位擋住重複遷移。
async function migrateStarsToV2(db, row) {
  if (Number(row.stars_version) >= 1) return row;
  const owned = parseJson(row.owned_chars, []);
  const oldStars = parseJson(row.char_stars, {});
  let crystals = Number(row.wish_crystals) || 0;
  const next = {};
  owned.forEach(id => {
    const old = intInRange(oldStars[id], 0, 0, 5);
    next[id] = Math.min(5, old + 1);
    if (old + 1 > 5) crystals += old + 1 - 5;
  });
  await db.prepare('UPDATE players SET char_stars=?2,wish_crystals=?3,stars_version=1,updated_at=unixepoch() WHERE uid=?1')
    .bind(row.uid, JSON.stringify(next), crystals).run();
  return db.prepare('SELECT * FROM players WHERE uid=?1').bind(row.uid).first();
}
function safeIds(value, allowed) {
  if (!Array.isArray(value)) throw apiError('Invalid inventory data.');
  const unique = [...new Set(value.map(String))];
  if (unique.some(id => !allowed.includes(id))) throw apiError('Invalid inventory ID.');
  return unique;
}
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function safeStars(value, owned) {
  // 新制：擁有的角色星級一律 1..5（抽到即★1）。
  const out = {};
  for (const [id, level] of Object.entries(safeObject(value))) {
    if (owned.includes(id)) out[id] = intInRange(level, 1, 1, 5);
  }
  // 後臺編輯若漏填某位已擁有角色的星級，補回最低的★1，避免寫進 0/undefined。
  owned.forEach(id => { if (!(id in out)) out[id] = 1; });
  return out;
}
function safeCards(value) {
  const out = {};
  for (const [id, count] of Object.entries(safeObject(value))) {
    if (FLOWER_CARD_IDS.includes(id)) out[id] = intInRange(count, 0, 0, 10);
  }
  return out;
}
function safeTeams(value, owned) {
  if (!Array.isArray(value) || value.length > 10) throw apiError('You can save at most 10 teams.');
  return value.map(team => {
    if (!team || typeof team.name !== 'string' || !Array.isArray(team.characterIds) || team.characterIds.length < 1 || team.characterIds.length > 3) {
      throw apiError('A team must contain 1 to 3 characters.');
    }
    const characterIds = team.characterIds.map(String);
    if (new Set(characterIds).size !== characterIds.length) throw apiError('A team cannot contain duplicate characters.');
    if (team.name.length > 30 || characterIds.some(id => !owned.includes(id))) throw apiError('A team includes a character you do not own.');
    const deck = team.deck && typeof team.deck === 'object' ? team.deck : {};
    // The deck editor deliberately keeps every card ID with a zero count. Zero is
    // therefore valid; only negative, non-integer, or over-limit counts are invalid.
    const total = Object.values(deck).reduce((sum, n) => sum + (Number.isInteger(n) && n >= 0 && n <= 10 ? n : 999), 0);
    if (total !== 10) throw apiError('Each deck must contain exactly 10 cards.');
    return { id: String(team.id || crypto.randomUUID()), name: team.name, characterIds, deck };
  });
}
function safePlayerName(value) {
  const name = String(value || '').trim();
  if (name.length < 1 || name.length > 16 || /[\u0000-\u001f<>]/.test(name)) throw apiError('名字須為 1～16 個字，且不可包含特殊控制字元。');
  return name;
}
function safeTutorialStep(value, fallback = 'intro') {
  return TUTORIAL_STEPS.includes(value) ? value : fallback;
}
function tutorialStepFromRow(row) {
  if (row.tutorial_done) return 'completed';
  return safeTutorialStep(row.tutorial_step, 'intro');
}
function tutorialStepAtLeast(current, expected) {
  return TUTORIAL_STEPS.indexOf(current) >= TUTORIAL_STEPS.indexOf(expected);
}
async function friendList(db, uid) {
  const result = await db.prepare(`SELECT p.uid,p.player_name
    FROM friendships f JOIN players p ON p.uid=CASE WHEN f.user_a=?1 THEN f.user_b ELSE f.user_a END
    WHERE f.user_a=?1 OR f.user_b=?1 ORDER BY p.player_name COLLATE NOCASE`).bind(uid).all();
  return (result.results || []).map(row => ({ uid: row.uid, playerName: row.player_name || '未命名玩家' }));
}
function randomPick(items) { return items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length]; }

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.PLAYER_DB) return json({ error: 'Account storage is not configured yet.' }, 503);
  try {
    const user = await requireUser(request);
    const db = env.PLAYER_DB;
    let row = await ensureProfile(db, user);
    row = await migrateStarsToV2(db, row); // 舊制星級一次性遷移（見函式說明）
    const action = Array.isArray(params.path) ? params.path.join('/') : String(params.path || '');
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const admin = isAdminUser(env, user);

    if (action === 'admin') {
      if (!admin) return json({ admin: false }, 403);
      return json({ admin: true });
    }
    if (action === 'admin-config') {
      if (!admin) return json({ error: 'Admin permission required.' }, 403);
      if (request.method === 'GET') return json({ config: await getGlobalConfig(db) });
      if (request.method === 'POST') return json({ config: await saveGlobalConfig(db, body.config) });
      return json({ error: 'Unknown API endpoint.' }, 404);
    }
    if (action === 'admin-players') {
      if (!admin) return json({ error: 'Admin permission required.' }, 403);
      if (request.method !== 'GET') return json({ error: 'Unknown API endpoint.' }, 404);
      const rows = await db.prepare('SELECT uid,email,gold,diamond,owned_chars,teams,tutorial_done,tutorial_step,updated_at FROM players ORDER BY updated_at DESC LIMIT 100').all();
      return json({ players: (rows.results || []).map(p => ({
        uid: p.uid, email: p.email, gold: p.gold, diamond: p.diamond,
        characterCount: parseJson(p.owned_chars, []).length, teamCount: parseJson(p.teams, []).length,
        tutorialDone: !!p.tutorial_done, tutorialStep: tutorialStepFromRow(p), updatedAt: p.updated_at
      })) });
    }
    if (action === 'admin-player') {
      if (!admin) return json({ error: 'Admin permission required.' }, 403);
      const uid = String(request.method === 'GET' ? new URL(request.url).searchParams.get('uid') : body.uid || '');
      const target = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(uid).first();
      if (!target) return json({ error: 'Player not found.' }, 404);
      return json({ player: { uid: target.uid, email: target.email, state: profileFromRow(target) } });
    }
    if (action === 'admin-player-update') {
      if (!admin) return json({ error: 'Admin permission required.' }, 403);
      if (request.method !== 'POST') return json({ error: 'Unknown API endpoint.' }, 404);
      const uid = String(body.uid || '');
      const target = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(uid).first();
      if (!target) return json({ error: 'Player not found.' }, 404);
      const input = body.state || {};
      const owned = safeIds(input.ownedCharIds, ALL_CHARACTER_IDS);
      const stars = safeStars(input.charStars, owned);
      const cards = safeCards(input.ownedCardCounts);
      const teams = safeTeams(input.teams, owned);
      const settings = safeObject(input.settings);
      const faction = input.tutorialFaction === 'white' || input.tutorialFaction === 'black' ? input.tutorialFaction : (target.tutorial_faction || 'black');
      const hero = input.lobbyHeroId === null ? null : (typeof input.lobbyHeroId === 'string' && owned.includes(input.lobbyHeroId) ? input.lobbyHeroId : target.lobby_hero_id || null);
      const dailyDate = typeof input.dailyBonusDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dailyBonusDate) ? input.dailyBonusDate : '';
      const tutorialDone = !!input.tutorialDone;
      const tutorialStep = tutorialDone ? 'completed' : (target.tutorial_done ? 'intro' : safeTutorialStep(input.tutorialStep, tutorialStepFromRow(target)));
      await db.prepare('UPDATE players SET gold=?2,diamond=?3,owned_chars=?4,char_stars=?5,owned_cards=?6,teams=?7,tutorial_done=?8,tutorial_step=?9,tutorial_faction=?10,lobby_hero_id=?11,settings=?12,daily_bonus_date=?13,wish_crystals=?14,updated_at=unixepoch() WHERE uid=?1')
        .bind(uid, intInRange(input.gold, target.gold), intInRange(input.diamond, target.diamond), JSON.stringify(owned), JSON.stringify(stars), JSON.stringify(cards), JSON.stringify(teams), tutorialDone ? 1 : 0, tutorialStep, faction, hero, JSON.stringify(settings), dailyDate, intInRange(input.wishCrystals, Number(target.wish_crystals) || 0)).run();
      const updated = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(uid).first();
      return json({ player: { uid: updated.uid, email: updated.email, state: profileFromRow(updated) } });
    }
    const config = await getGlobalConfig(db);
    if (request.method === 'GET' && action === 'state') return json({ state: profileFromRow(row), config });
    if (request.method === 'GET' && action === 'friends') return json({ friends: await friendList(db, user.uid) });
    if (request.method !== 'POST') return json({ error: 'Unknown API endpoint.' }, 404);
    if (action === 'bootstrap') return json({ state: profileFromRow(row), config });

    if (action === 'tutorial-starter') {
      const id = String(body.id || '');
      const owned = parseJson(row.owned_chars, []);
      const step = tutorialStepFromRow(row);
      if (step === 'battle' && owned.includes(id)) return json({ state: profileFromRow(row) });
      if (row.tutorial_done || step !== 'starter' || owned.length !== 0 || !['001', '004', '006'].includes(id)) throw apiError('The starter selection is no longer available.');
      owned.push(id);
      const starterStars = parseJson(row.char_stars, {});
      starterStars[id] = 1; // 新制：起始角色也是★1
      await db.prepare("UPDATE players SET owned_chars=?2,char_stars=?3,tutorial_step='battle',updated_at=unixepoch() WHERE uid=?1").bind(user.uid, JSON.stringify(owned), JSON.stringify(starterStars)).run();
    } else if (action === 'tutorial-gacha') {
      const currency = body.currency === 'diamond' ? 'diamond' : 'gold';
      const owned = parseJson(row.owned_chars, []), stars = parseJson(row.char_stars, {});
      const expected = currency === 'gold' ? 'gold_summon' : 'diamond_summon';
      const nextStep = currency === 'gold' ? 'diamond_summon' : 'team';
      const step = tutorialStepFromRow(row);
      if (tutorialStepAtLeast(step, nextStep) && owned.length) {
        const id = owned[owned.length - 1];
        return json({ state: profileFromRow(row), results: [{ id, isNew: false, starLevel: Number(stars[id] || 1) }] });
      }
      if (row.tutorial_done || step !== expected || owned.length < 1) throw apiError('This tutorial reward is no longer available.');
      const id = configuredGachaPick(config, currency, owned);
      owned.push(id);
      stars[id] = 1; // 新制：剛抽到＝★1
      await db.prepare('UPDATE players SET owned_chars=?2,char_stars=?3,tutorial_step=?4,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(owned), JSON.stringify(stars), nextStep).run();
      row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
      return json({ state: profileFromRow(row), results: [{ id, isNew: true, starLevel: 1 }] });
    } else if (action === 'tutorial-progress') {
      if (!TUTORIAL_STEPS.includes(body.step)) throw apiError('Invalid tutorial step.');
      const requested = body.step;
      const current = tutorialStepFromRow(row);
      if (requested === current || tutorialStepAtLeast(current, requested)) return json({ state: profileFromRow(row) });
      const allowed = (current === 'battle' && requested === 'gold_summon') || (current === 'team' && requested === 'ending');
      if (!allowed) throw apiError('Tutorial progress is out of sequence.');
      if (requested === 'ending' && parseJson(row.teams, []).length < 1) throw apiError('Save a team before continuing the tutorial.');
      await db.prepare('UPDATE players SET tutorial_step=?2,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, requested).run();
    } else if (action === 'tutorial-complete') {
      const owned = parseJson(row.owned_chars, []);
      if (owned.length < 3) throw apiError('Finish the starter and two tutorial summons first.');
      await db.prepare("UPDATE players SET tutorial_done=1,tutorial_step='completed',updated_at=unixepoch() WHERE uid=?1").bind(user.uid).run();
    } else if (action === 'teams') {
      const teams = safeTeams(body.teams, parseJson(row.owned_chars, []));
      const nextStep = tutorialStepFromRow(row) === 'team' && teams.length ? 'ending' : tutorialStepFromRow(row);
      await db.prepare('UPDATE players SET teams=?2,tutorial_step=?3,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(teams), nextStep).run();
    } else if (action === 'profile-name') {
      const playerName = safePlayerName(body.playerName);
      try {
        const nextStep = tutorialStepFromRow(row) === 'intro' ? 'starter' : tutorialStepFromRow(row);
        await db.prepare('UPDATE players SET player_name=?2,tutorial_step=?3,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, playerName, nextStep).run();
      } catch (error) {
        if (/UNIQUE|constraint/i.test(String(error && error.message))) throw apiError('這個名字已被其他玩家使用。', 409);
        throw error;
      }
    } else if (action === 'friend-add') {
      const targetName = safePlayerName(body.playerName);
      const target = await db.prepare('SELECT uid FROM players WHERE player_name=?1 COLLATE NOCASE').bind(targetName).first();
      if (!target) throw apiError('找不到這位玩家。', 404);
      if (target.uid === user.uid) throw apiError('不能把自己加為好友。');
      const ownCount = await db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE user_a=?1 OR user_b=?1').bind(user.uid).first();
      const targetCount = await db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE user_a=?1 OR user_b=?1').bind(target.uid).first();
      if ((ownCount && ownCount.n >= 50) || (targetCount && targetCount.n >= 50)) throw apiError('好友人數已達 50 人上限。');
      const a = user.uid < target.uid ? user.uid : target.uid, b = user.uid < target.uid ? target.uid : user.uid;
      await db.prepare('INSERT OR IGNORE INTO friendships (user_a,user_b,created_at) VALUES (?1,?2,unixepoch())').bind(a, b).run();
      return json({ friends: await friendList(db, user.uid) });
    } else if (action === 'friend-remove') {
      const targetUid = String(body.uid || '');
      const a = user.uid < targetUid ? user.uid : targetUid, b = user.uid < targetUid ? targetUid : user.uid;
      await db.prepare('DELETE FROM friendships WHERE user_a=?1 AND user_b=?2').bind(a, b).run();
      return json({ friends: await friendList(db, user.uid) });
    } else if (action === 'preferences') {
      const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
      const faction = body.tutorialFaction === 'white' ? 'white' : 'black';
      const hero = typeof body.lobbyHeroId === 'string' && ALL_CHARACTER_IDS.includes(body.lobbyHeroId) ? body.lobbyHeroId : null;
      await db.prepare('UPDATE players SET settings=?2,tutorial_faction=?3,lobby_hero_id=?4,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(settings), faction, hero).run();
    } else if (action === 'daily-claim') {
      const today = todayUtc();
      if (row.daily_bonus_date !== today) await db.prepare('UPDATE players SET gold=gold+?2,diamond=diamond+?3,daily_bonus_date=?4,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, config.settings.dailyGold, config.settings.dailyDiamond, today).run();
    } else if (action === 'gacha') {
      const currency = body.currency === 'diamond' ? 'diamond' : 'gold';
      const count = body.count === 10 ? 10 : 1;
      const cost = currency === 'gold' ? (count === 10 ? config.settings.goldGachaTenCost : config.settings.goldGachaOneCost) : (count === 10 ? config.settings.diamondGachaTenCost : config.settings.diamondGachaOneCost);
      if (row[currency] < cost) throw apiError('Not enough currency.');
      const owned = parseJson(row.owned_chars, []), stars = parseJson(row.char_stars, {});
      let crystals = Number(row.wish_crystals) || 0;
      const results = [];
      for (let i = 0; i < count; i++) {
        const id = configuredGachaPick(config, currency), isNew = !owned.includes(id);
        let gotCrystal = false;
        if (isNew) { owned.push(id); stars[id] = 1; } // 新制：剛抽到＝★1
        else if ((stars[id] || 1) < 5) stars[id] = (stars[id] || 1) + 1;
        else { crystals += 1; gotCrystal = true; } // 已滿星：重複轉願望結晶
        results.push({ id, isNew, starLevel: stars[id] || 1, gotCrystal });
      }
      await db.prepare('UPDATE players SET ' + currency + '=' + currency + '-?2,owned_chars=?3,char_stars=?4,wish_crystals=?5,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, cost, JSON.stringify(owned), JSON.stringify(stars), crystals).run();
      row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
      return json({ state: profileFromRow(row), results });
    } else if (action === 'skill-upgrade') {
      const charId = String(body.charId || ''), slot = String(body.slot || '');
      const owned = parseJson(row.owned_chars, []);
      if (!owned.includes(charId)) throw apiError('你尚未擁有這位角色。');
      if (!SKILL_SLOTS.includes(slot)) throw apiError('無效的技能種類。');
      const progress = progressionFromRow(row);
      const perChar = safeObject(progress.levels[charId]);
      const current = intInRange(perChar[slot], 1, 1, 5);
      if (current >= 5) throw apiError('這項技能已經滿級。');
      const cost = current * 2;
      if (progress.fragments[slot] < cost) throw apiError(slot + '之碎片不足，需要 ' + cost + ' 枚。');
      perChar[slot] = current + 1;
      progress.levels[charId] = perChar;
      progress.fragments[slot] -= cost;
      const oldPacked = row.move_levels || '{}';
      const nextPacked = JSON.stringify(packedProgression(progress.levels, progress.fragments, progress.hunt));
      const result = await db.prepare('UPDATE players SET move_levels=?2,updated_at=unixepoch() WHERE uid=?1 AND move_levels=?3')
        .bind(user.uid, nextPacked, oldPacked).run();
      if (!result.meta || result.meta.changes !== 1) throw apiError('進度已在其他裝置更新，請重試。', 409);
    } else if (action === 'hunt-start') {
      const teamId = String(body.teamId || ''), slot = String(body.slot || '');
      if (!SKILL_SLOTS.includes(slot)) throw apiError('無效的狩獵區域。');
      const teams = parseJson(row.teams, []), team = teams.find(item => String(item.id) === teamId);
      if (!team || !Array.isArray(team.characterIds) || !team.characterIds.length) throw apiError('找不到這支隊伍。');
      const progress = progressionFromRow(row);
      if (progress.hunt) throw apiError(Date.now() >= Number(progress.hunt.endsAt) ? '已有完成的狩獵尚未領取。' : '目前已有隊伍正在狩獵。');
      const now = Date.now();
      progress.hunt = { teamId, teamName: String(team.name || '隊伍'), slot, reward: Math.max(1, Math.min(3, team.characterIds.length)), startedAt: now, endsAt: now + HUNT_DURATION_MS };
      const oldPacked = row.move_levels || '{}';
      const nextPacked = JSON.stringify(packedProgression(progress.levels, progress.fragments, progress.hunt));
      const result = await db.prepare('UPDATE players SET move_levels=?2,updated_at=unixepoch() WHERE uid=?1 AND move_levels=?3')
        .bind(user.uid, nextPacked, oldPacked).run();
      if (!result.meta || result.meta.changes !== 1) throw apiError('進度已在其他裝置更新，請重試。', 409);
    } else if (action === 'hunt-claim') {
      const progress = progressionFromRow(row), hunt = progress.hunt;
      if (!hunt) throw apiError('目前沒有可領取的狩獵獎勵。');
      if (Date.now() < Number(hunt.endsAt)) throw apiError('狩獵尚未完成。');
      if (!SKILL_SLOTS.includes(hunt.slot)) throw apiError('狩獵資料異常。');
      progress.fragments[hunt.slot] += Math.max(1, Math.min(3, intInRange(hunt.reward, 1, 1, 3)));
      const oldPacked = row.move_levels || '{}';
      const nextPacked = JSON.stringify(packedProgression(progress.levels, progress.fragments, null));
      const result = await db.prepare('UPDATE players SET move_levels=?2,updated_at=unixepoch() WHERE uid=?1 AND move_levels=?3')
        .bind(user.uid, nextPacked, oldPacked).run();
      if (!result.meta || result.meta.changes !== 1) throw apiError('獎勵已被領取或進度已更新。', 409);
    } else if (action === 'starup') {
      // 用願望結晶幫角色升一星（2026-07升星改制）。消耗依目標星級遞增：升到 N+1 星要 N 顆
      // （★1→★2=1顆…★4→★5=4顆），跟前端 crystalCostForNextStar() 同一套規則，由伺服器驗證。
      const charId = String(body.charId || '');
      const owned = parseJson(row.owned_chars, []);
      if (!owned.includes(charId)) throw apiError('你尚未擁有這位角色。');
      const stars = parseJson(row.char_stars, {});
      const current = intInRange(stars[charId], 1, 1, 5);
      if (current >= 5) throw apiError('這位角色已經滿星。');
      const cost = current;
      const crystals = Number(row.wish_crystals) || 0;
      if (crystals < cost) throw apiError('願望結晶不足（需要 ' + cost + ' 顆）。');
      stars[charId] = current + 1;
      await db.prepare('UPDATE players SET char_stars=?2,wish_crystals=?3,updated_at=unixepoch() WHERE uid=?1')
        .bind(user.uid, JSON.stringify(stars), crystals - cost).run();
    } else if (action === 'shop-buy') {
      const cardId = String(body.cardId || '');
      if (!FLOWER_CARD_IDS.includes(cardId)) throw apiError('Invalid card.');
      const cards = parseJson(row.owned_cards, {}), count = cards[cardId] || 0;
      if (count >= 10) throw apiError('You already own the maximum number of this card.');
      const price = configuredCardPrice(config, cardId);
      if (row.gold < price) throw apiError('Not enough gold.');
      cards[cardId] = count + 1;
      await db.prepare('UPDATE players SET gold=gold-?2,owned_cards=?3,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, price, JSON.stringify(cards)).run();
    } else return json({ error: 'Unknown API endpoint.' }, 404);

    row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
    return json({ state: profileFromRow(row) });
  } catch (error) {
    return json({ error: error.message || 'Account request failed.' }, error.status || 500);
  }
}
