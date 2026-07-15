/*
 * Secure account API for Cloudflare Pages Functions + D1.
 * Firebase Auth identifies the player; inventory and currency live only in D1.
 */
const FIREBASE_API_KEY = 'AIzaSyBGg5KcXJmiQGCdCnEQ_hn4knulcemyKhY';
const GOLD_START = 500, DIAMOND_START = 30;
const FLOWER_CARD_IDS = Array.from({ length: 22 }, (_, i) => String(i + 5).padStart(3, '0'));
const ALL_CHARACTER_IDS = Array.from({ length: 21 }, (_, i) => String(i + 1).padStart(3, '0'));
const DIAMOND_EXCLUSIVE_IDS = new Set(['016', '014', '003', '021', '018', '020']);

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
    characters: null, moves: null, cards: null,
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
  const list = (key, max) => Array.isArray(source[key]) && source[key].length <= max ? source[key] : null;
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  return {
    characters: list('characters', 100), moves: list('moves', 500), cards: list('cards', 200),
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
function profileFromRow(row) {
  return {
    gold: row.gold, diamond: row.diamond,
    ownedCharIds: parseJson(row.owned_chars, []), charStars: parseJson(row.char_stars, {}),
    ownedCardCounts: parseJson(row.owned_cards, {}), teams: parseJson(row.teams, []),
    tutorialDone: !!row.tutorial_done, tutorialFaction: row.tutorial_faction || 'black',
    lobbyHeroId: row.lobby_hero_id || null, settings: parseJson(row.settings, {}),
    dailyBonusDate: row.daily_bonus_date || ''
  };
}
async function ensureProfile(db, user) {
  // A new account begins with no inventory. Tutorial grants are handled below,
  // one time only, rather than trusting the browser to add characters.
  await db.prepare(`INSERT OR IGNORE INTO players
    (uid,email,gold,diamond,owned_chars,char_stars,owned_cards,teams,tutorial_done,tutorial_faction,lobby_hero_id,settings,daily_bonus_date,created_at,updated_at)
    VALUES (?1,?2,?3,?4,'[]','{}','{}','[]',0,'black',NULL,'{}','',unixepoch(),unixepoch())`)
    .bind(user.uid, user.email, GOLD_START, DIAMOND_START).run();
  return db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
}
function safeIds(value, allowed) {
  if (!Array.isArray(value)) throw apiError('Invalid inventory data.');
  const unique = [...new Set(value.map(String))];
  if (unique.some(id => !allowed.includes(id))) throw apiError('Invalid inventory ID.');
  return unique;
}
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function safeStars(value, owned) {
  const out = {};
  for (const [id, level] of Object.entries(safeObject(value))) {
    if (owned.includes(id)) out[id] = intInRange(level, 0, 0, 5);
  }
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
  if (!Array.isArray(value) || value.length > 50) throw apiError('Invalid team data.');
  return value.map(team => {
    if (!team || typeof team.name !== 'string' || !Array.isArray(team.characterIds) || team.characterIds.length !== 3) throw apiError('Invalid team data.');
    if (team.name.length > 30 || team.characterIds.some(id => !owned.includes(id))) throw apiError('A team includes a character you do not own.');
    const deck = team.deck && typeof team.deck === 'object' ? team.deck : {};
    // The deck editor deliberately keeps every card ID with a zero count. Zero is
    // therefore valid; only negative, non-integer, or over-limit counts are invalid.
    const total = Object.values(deck).reduce((sum, n) => sum + (Number.isInteger(n) && n >= 0 && n <= 10 ? n : 999), 0);
    if (total !== 10) throw apiError('Each deck must contain exactly 10 cards.');
    return { id: String(team.id || crypto.randomUUID()), name: team.name, characterIds: team.characterIds, deck };
  });
}
function randomPick(items) { return items[crypto.getRandomValues(new Uint32Array(1))[0] % items.length]; }

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!env.PLAYER_DB) return json({ error: 'Account storage is not configured yet.' }, 503);
  try {
    const user = await requireUser(request);
    const db = env.PLAYER_DB;
    let row = await ensureProfile(db, user);
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
      const rows = await db.prepare('SELECT uid,email,gold,diamond,owned_chars,teams,tutorial_done,updated_at FROM players ORDER BY updated_at DESC LIMIT 100').all();
      return json({ players: (rows.results || []).map(p => ({
        uid: p.uid, email: p.email, gold: p.gold, diamond: p.diamond,
        characterCount: parseJson(p.owned_chars, []).length, teamCount: parseJson(p.teams, []).length,
        tutorialDone: !!p.tutorial_done, updatedAt: p.updated_at
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
      await db.prepare('UPDATE players SET gold=?2,diamond=?3,owned_chars=?4,char_stars=?5,owned_cards=?6,teams=?7,tutorial_done=?8,tutorial_faction=?9,lobby_hero_id=?10,settings=?11,daily_bonus_date=?12,updated_at=unixepoch() WHERE uid=?1')
        .bind(uid, intInRange(input.gold, target.gold), intInRange(input.diamond, target.diamond), JSON.stringify(owned), JSON.stringify(stars), JSON.stringify(cards), JSON.stringify(teams), input.tutorialDone ? 1 : 0, faction, hero, JSON.stringify(settings), dailyDate).run();
      const updated = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(uid).first();
      return json({ player: { uid: updated.uid, email: updated.email, state: profileFromRow(updated) } });
    }
    const config = await getGlobalConfig(db);
    if (request.method === 'GET' && action === 'state') return json({ state: profileFromRow(row), config });
    if (request.method !== 'POST') return json({ error: 'Unknown API endpoint.' }, 404);
    if (action === 'bootstrap') return json({ state: profileFromRow(row), config });

    if (action === 'tutorial-starter') {
      const id = String(body.id || '');
      const owned = parseJson(row.owned_chars, []);
      if (row.tutorial_done || owned.length !== 0 || !['001', '004', '006'].includes(id)) throw apiError('The starter selection is no longer available.');
      owned.push(id);
      await db.prepare('UPDATE players SET owned_chars=?2,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(owned)).run();
    } else if (action === 'tutorial-gacha') {
      const currency = body.currency === 'diamond' ? 'diamond' : 'gold';
      const owned = parseJson(row.owned_chars, []), stars = parseJson(row.char_stars, {});
      if (row.tutorial_done || owned.length < 1 || owned.length >= 3) throw apiError('This tutorial reward is no longer available.');
      const id = configuredGachaPick(config, currency, owned);
      owned.push(id);
      await db.prepare('UPDATE players SET owned_chars=?2,char_stars=?3,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(owned), JSON.stringify(stars)).run();
      row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
      return json({ state: profileFromRow(row), results: [{ id, isNew: true, starLevel: 0 }] });
    } else if (action === 'tutorial-complete') {
      const owned = parseJson(row.owned_chars, []);
      if (owned.length < 3) throw apiError('Finish the starter and two tutorial summons first.');
      await db.prepare('UPDATE players SET tutorial_done=1,updated_at=unixepoch() WHERE uid=?1').bind(user.uid).run();
    } else if (action === 'teams') {
      const teams = safeTeams(body.teams, parseJson(row.owned_chars, []));
      await db.prepare('UPDATE players SET teams=?2,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(teams)).run();
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
      const results = [];
      for (let i = 0; i < count; i++) {
        const id = configuredGachaPick(config, currency), isNew = !owned.includes(id);
        if (isNew) owned.push(id); else stars[id] = Math.min(5, (stars[id] || 0) + 1);
        results.push({ id, isNew, starLevel: stars[id] || 0 });
      }
      await db.prepare('UPDATE players SET ' + currency + '=' + currency + '-?2,owned_chars=?3,char_stars=?4,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, cost, JSON.stringify(owned), JSON.stringify(stars)).run();
      row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
      return json({ state: profileFromRow(row), results });
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
