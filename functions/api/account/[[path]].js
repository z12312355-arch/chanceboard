/*
 * Secure account API for Cloudflare Pages Functions + D1.
 * Firebase Auth identifies the player; inventory and currency live only in D1.
 */
const FIREBASE_API_KEY = 'AIzaSyBGg5KcXJmiQGCdCnEQ_hn4knulcemyKhY';
const GOLD_START = 500, DIAMOND_START = 30;
const DAILY_GOLD = 200, DAILY_DIAMOND = 5;
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

    if (action === 'admin') {
      const csv = value => String(env[value] || '').split(',').map(v => v.trim()).filter(Boolean);
      const allowedUids = csv('ADMIN_UIDS');
      const allowedEmails = csv('ADMIN_EMAILS').map(v => v.toLowerCase());
      const isAdmin = allowedUids.includes(user.uid) || allowedEmails.includes(user.email.toLowerCase());
      if (!isAdmin) return json({ admin: false }, 403);
      return json({ admin: true });
    }
    if (request.method === 'GET' && action === 'state') return json({ state: profileFromRow(row) });
    if (request.method !== 'POST') return json({ error: 'Unknown API endpoint.' }, 404);
    if (action === 'bootstrap') return json({ state: profileFromRow(row) });

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
      const pool = (currency === 'diamond' ? ALL_CHARACTER_IDS : ALL_CHARACTER_IDS.filter(id => !DIAMOND_EXCLUSIVE_IDS.has(id))).filter(id => !owned.includes(id));
      const id = randomPick(pool);
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
      if (row.daily_bonus_date !== today) await db.prepare('UPDATE players SET gold=gold+?2,diamond=diamond+?3,daily_bonus_date=?4,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, DAILY_GOLD, DAILY_DIAMOND, today).run();
    } else if (action === 'gacha') {
      const currency = body.currency === 'diamond' ? 'diamond' : 'gold';
      const count = body.count === 10 ? 10 : 1;
      const cost = currency === 'gold' ? (count === 10 ? 1000 : 100) : (count === 10 ? 100 : 10);
      if (row[currency] < cost) throw apiError('Not enough currency.');
      const owned = parseJson(row.owned_chars, []), stars = parseJson(row.char_stars, {});
      const pool = currency === 'diamond' ? ALL_CHARACTER_IDS : ALL_CHARACTER_IDS.filter(id => !DIAMOND_EXCLUSIVE_IDS.has(id));
      const results = [];
      for (let i = 0; i < count; i++) {
        const id = randomPick(pool), isNew = !owned.includes(id);
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
      if (row.gold < 150) throw apiError('Not enough gold.');
      cards[cardId] = count + 1;
      await db.prepare('UPDATE players SET gold=gold-150,owned_cards=?2,updated_at=unixepoch() WHERE uid=?1').bind(user.uid, JSON.stringify(cards)).run();
    } else return json({ error: 'Unknown API endpoint.' }, 404);

    row = await db.prepare('SELECT * FROM players WHERE uid=?1').bind(user.uid).first();
    return json({ state: profileFromRow(row) });
  } catch (error) {
    return json({ error: error.message || 'Account request failed.' }, error.status || 500);
  }
}
