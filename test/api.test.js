// End-to-end tests for the HTTP server. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brickfall-test-'));
process.env.DATA_DIR = dataDir;
process.env.RATE_LIMIT_SCALE = '100';
process.env.LOG_REQUESTS = '0';
process.env.CORS_ORIGINS = 'https://*.crazygames.com';
// a stand-in for CrazyGames' signing key, so the tests can mint user tokens
const cgKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.CRAZYGAMES_PUBLIC_KEY = cgKeys.publicKey.export({ type: 'spki', format: 'pem' });

const { createServer } = await import('../server/index.js');
const { closeDb } = await import('../server/db.js');
const { closeChat } = await import('../server/chat.js');

let server, base;

before(() => new Promise((resolve) => {
  server = createServer();
  server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));

after(() => new Promise((resolve) => {
  closeChat();
  server.close(() => {
    closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    resolve();
  });
}));

/** Tiny cookie-keeping HTTP client. */
class Client {
  cookie = '';
  async request(method, p, body, headers = {}) {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, headers) { return this.request('GET', p, undefined, headers); }
  post(p, body = {}, headers) { return this.request('POST', p, body, headers); }
}

test('health check and security headers', async () => {
  const r = await new Client().get('/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('serves the game with compression and ETags', async () => {
  const c = new Client();
  const r = await c.get('/', { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>Brickfall/);
  const etag = r.headers.get('etag');
  assert.ok(etag);
  const again = await c.get('/', { 'if-none-match': etag });
  assert.equal(again.status, 304);
});

test('blocks path traversal and shows a 404 page', async () => {
  const c = new Client();
  assert.notEqual((await c.get('/..%2fserver%2findex.js')).status, 200);
  const missing = await c.get('/nope', { accept: 'text/html' });
  assert.equal(missing.status, 404);
  assert.match(missing.text, /doesn't exist/);
});

test('API routing errors', async () => {
  const c = new Client();
  assert.equal((await c.get('/api/nothing')).status, 404);
  assert.equal((await c.get('/api/login')).status, 405);
  const notJson = await fetch(`${base}/api/login`, { method: 'POST', body: 'name=x' });
  assert.equal(notJson.status, 415);
});

test('registration validates input and filters names', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/register', { name: 'a!', password: 'password123' })).status, 400);
  assert.equal((await c.post('/api/register', { name: 'Admin', password: 'password123' })).status, 400);
  assert.equal((await c.post('/api/register', { name: 'sh1tlord', password: 'password123' })).status, 400);
  assert.equal((await c.post('/api/register', { name: 'valid_name', password: 'short' })).status, 400);
  const ok = await c.post('/api/register', { name: 'Alice_01', password: 'password123' });
  assert.equal(ok.status, 201);
  assert.ok(c.cookie.startsWith('bf_session='));
  assert.equal((await new Client().post('/api/register', { name: 'alice_01', password: 'password123' })).status, 409);
  const me = await c.get('/api/me');
  assert.equal(me.json.user.name, 'Alice_01');
});

test('rejects cross-site POSTs', async () => {
  const r = await new Client().post('/api/login', { name: 'Alice_01', password: 'password123' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('login, match reports are clamped, leaderboard ranks', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/login', { name: 'Alice_01', password: 'wrong-password' })).status, 401);
  assert.equal((await c.post('/api/login', { name: 'ALICE_01', password: 'password123' })).status, 200);

  const { json: m } = await c.post('/api/match/start', { mode: 'arena' });
  assert.equal(m.matchId.length, 32);
  const r = await c.post('/api/match/report', { matchId: m.matchId, kills: 500, deaths: 0, coins: 99999, seconds: 9999, bestStreak: 500 });
  assert.equal(r.status, 200);
  assert.ok(r.json.accepted.kills <= 3, 'impossible kill counts are trimmed');
  assert.ok(r.json.accepted.coins <= r.json.accepted.kills * 120, 'coins are capped per kill (room for rank bonuses)');
  assert.ok(r.json.accepted.xp <= r.json.accepted.kills * 60);

  const board = await c.get('/api/leaderboard?mode=arena&period=all&sort=kills');
  assert.equal(board.json.rows[0].name, 'Alice_01');
  assert.equal(board.json.me.rank, 1);
  const week = await c.get('/api/leaderboard?mode=arena&period=week');
  assert.match(week.json.key, /^\d{4}-W\d{2}$/);
  const day = await c.get('/api/leaderboard?mode=arena&period=day');
  assert.match(day.json.key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(day.json.rows[0].name, 'Alice_01', 'kills count on the daily board too');
  assert.equal(day.json.rows[0].skin, 'rowan');
  assert.ok(day.json.rows[0].level >= 1);
  assert.equal((await c.get('/api/leaderboard?mode=nope')).status, 400);
  assert.equal((await c.post('/api/match/report', { matchId: 'x'.repeat(32) })).status, 404);
});

test('changing the password signs out other sessions', async () => {
  const phone = new Client(), laptop = new Client();
  await phone.post('/api/register', { name: 'Bob_02', password: 'password123' });
  await laptop.post('/api/login', { name: 'Bob_02', password: 'password123' });
  assert.equal((await laptop.post('/api/account/password', { currentPassword: 'nope', newPassword: 'newpassword1' })).status, 403);
  assert.equal((await laptop.post('/api/account/password', { currentPassword: 'password123', newPassword: 'newpassword1' })).status, 200);
  assert.equal((await laptop.get('/api/me')).json.user.name, 'Bob_02', 'the device that changed it stays signed in');
  assert.equal((await phone.get('/api/me')).json.user, null, 'other devices are signed out');
  assert.equal((await new Client().post('/api/login', { name: 'Bob_02', password: 'newpassword1' })).status, 200);
});

test('deleting an account removes it everywhere', async () => {
  const c = new Client();
  await c.post('/api/register', { name: 'Carol_03', password: 'password123' });
  const { json: m } = await c.post('/api/match/start', { mode: 'arena' });
  await c.post('/api/match/report', { matchId: m.matchId, kills: 1, seconds: 3 });
  assert.equal((await c.post('/api/account/delete', { password: 'wrong' })).status, 403);
  assert.equal((await c.post('/api/account/delete', { password: 'password123' })).status, 200);
  assert.equal((await c.get('/api/me')).json.user, null);
  const board = await new Client().get('/api/leaderboard?mode=arena');
  assert.ok(!board.json.rows.some((r) => r.name === 'Carol_03'));
  assert.equal((await new Client().post('/api/login', { name: 'Carol_03', password: 'password123' })).status, 401);
});

test('signed-out users cannot use account endpoints', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/match/start', { mode: 'arena' })).status, 401);
  assert.equal((await c.post('/api/account/password', {})).status, 401);
  assert.equal((await c.post('/api/logout')).status, 200);
});

test('shop: earn coins, buy skins/capes/ranks, equip only what you own', async () => {
  const { q } = await import('../server/db.js');
  const c = new Client();
  await c.post('/api/register', { name: 'Dana_04', password: 'password123' });
  let me = (await c.get('/api/me')).json;
  assert.equal(me.user.rankId, 'NONE');
  assert.equal(me.wallet.coins, 0);
  assert.deepEqual(me.cosmetics, { skin: 'rowan', cape: 'none' });

  // can't equip or buy what you can't afford
  assert.deepEqual((await c.post('/api/cosmetics', { cosmetics: { skin: 'knight', cape: 'ember' } })).json.cosmetics, { skin: 'rowan', cape: 'none' });
  assert.equal((await c.post('/api/shop/buy', { kind: 'skin', id: 'knight' })).status, 400);
  assert.equal((await c.post('/api/shop/buy', { kind: 'cape', id: 'titan' })).status, 400, 'rank capes are not for sale');

  // earn coins + XP from a match
  const { json: m } = await c.post('/api/match/start', { mode: 'arena' });
  const rep = await c.post('/api/match/report', { matchId: m.matchId, kills: 2, deaths: 0, coins: 50, xp: 44, seconds: 3, bestStreak: 2 });
  assert.equal(rep.json.accepted.xp, 44);
  me = (await c.get('/api/me')).json;
  assert.equal(me.wallet.coins, 50);
  assert.equal(me.progress.xp, 44);

  // top up with the admin tool's query, then shop
  q.spendCoins.run(-20000, q.userByName.get('Dana_04').id);
  const bought = await c.post('/api/shop/buy', { kind: 'skin', id: 'knight' });
  assert.equal(bought.status, 200);
  assert.equal(bought.json.wallet.coins, 20050 - 2000);
  assert.ok(bought.json.owned.skin.includes('knight'));
  assert.equal((await c.post('/api/shop/buy', { kind: 'skin', id: 'knight' })).status, 400, "can't buy twice");
  assert.equal((await c.post('/api/cosmetics', { cosmetics: { skin: 'knight', cape: 'none' } })).json.cosmetics.skin, 'knight');

  // ranks: buy ACE, upgrade to HERO for the difference, rank perks unlock
  const ace = await c.post('/api/shop/buy', { kind: 'rank', id: 'ACE' });
  assert.equal(ace.json.paidRank, 'ACE');
  const hero = await c.post('/api/shop/buy', { kind: 'rank', id: 'HERO' });
  assert.equal(hero.json.spent, 7500 - 2500);
  assert.equal(hero.json.wallet.coins, 20050 - 2000 - 2500 - 5000);
  assert.equal((await c.post('/api/shop/buy', { kind: 'rank', id: 'ACE' })).status, 400, 'no downgrades');
  me = (await c.get('/api/me')).json;
  assert.equal(me.user.rankId, 'HERO');
  const perks = await c.post('/api/cosmetics', { cosmetics: { skin: 'guardian', cape: 'hero' } });
  assert.deepEqual(perks.json.cosmetics, { skin: 'guardian', cape: 'hero' });

  const board = await c.get('/api/leaderboard?mode=arena');
  const row = board.json.rows.find((r) => r.name === 'Dana_04');
  assert.equal(row.rankId, 'HERO');
  assert.equal(row.skin, 'guardian');
  assert.equal((await new Client().post('/api/shop/buy', { kind: 'skin', id: 'knight' })).status, 401);
});

test('staff ranks override purchased ranks and unlock everything', async () => {
  const { q } = await import('../server/db.js');
  const c = new Client();
  await c.post('/api/register', { name: 'Eve_05', password: 'password123' });
  q.setStaffRank.run('ADMIN', q.userByName.get('Eve_05').id);
  assert.equal((await c.get('/api/me')).json.user.rankId, 'ADMIN');
  const saved = await c.post('/api/cosmetics', { cosmetics: { skin: 'titanking', cape: 'staff' } });
  assert.deepEqual(saved.json.cosmetics, { skin: 'titanking', cape: 'staff' });
  assert.equal((await c.post('/api/shop/buy', { kind: 'rank', id: 'TITAN' })).status, 400, 'staff have nothing to buy');
});

test('every game mode keeps its own leaderboard', async () => {
  const c = new Client();
  await c.post('/api/register', { name: 'Finn_06', password: 'password123' });
  const { json: m } = await c.post('/api/match/start', { mode: 'potpvp' });
  await c.post('/api/match/report', { matchId: m.matchId, kills: 2, deaths: 1, coins: 40, xp: 40, seconds: 3, bestStreak: 2 });

  const pot = await c.get('/api/leaderboard?mode=potpvp');
  assert.deepEqual(Object.keys(pot.json.modes), ['arena', 'potpvp', 'sumo', 'combo']);
  assert.equal(pot.json.rows[0].name, 'Finn_06');
  assert.equal(pot.json.me.kills, 2);
  assert.equal((await c.get('/api/leaderboard?mode=sumo')).json.rows.length, 0, 'other modes are untouched');
  assert.ok(!(await c.get('/api/leaderboard?mode=arena')).json.rows.some((r) => r.name === 'Finn_06'));
  assert.equal((await c.get('/api/me?mode=potpvp')).json.stats.kills, 2);
  assert.equal((await c.get('/api/me')).json.progress.xp, 40, 'XP counts toward your level in every mode');
  assert.equal((await c.post('/api/match/start', { mode: 'bedwars' })).status, 400);
});

test('sign up with an optional email, log in with name or email', async () => {
  const c = new Client();
  const bad = await c.post('/api/register', { name: 'Gina_07', password: 'password123', email: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.equal((await c.post('/api/register', { name: 'Gina_07', password: 'password123', email: 'Gina@Example.com' })).status, 201);
  assert.equal((await c.get('/api/me')).json.user.email, 'gina@example.com', 'stored lowercase');
  const dupe = await new Client().post('/api/register', { name: 'Gina_08', password: 'password123', email: 'GINA@example.com' });
  assert.equal(dupe.status, 409);

  const byEmail = new Client();
  assert.equal((await byEmail.post('/api/login', { name: 'gina@EXAMPLE.com', password: 'password123' })).status, 200);
  assert.equal((await byEmail.get('/api/me')).json.user.name, 'Gina_07');
  assert.equal((await new Client().post('/api/login', { name: 'gina@example.com', password: 'wrong-pass' })).status, 401);

  // no email is fine too, and one can be added later (password required)
  const d = new Client();
  await d.post('/api/register', { name: 'Hank_09', password: 'password123' });
  assert.equal((await d.get('/api/me')).json.user.email, null);
  assert.equal((await d.post('/api/account/email', { password: 'nope-nope', email: 'hank@example.com' })).status, 403);
  assert.equal((await d.post('/api/account/email', { password: 'password123', email: 'gina@example.com' })).status, 409);
  assert.equal((await d.post('/api/account/email', { password: 'password123', email: 'hank@example.com' })).json.email, 'hank@example.com');
  // email never shows up publicly
  const board = await new Client().get('/api/leaderboard?mode=arena');
  assert.ok(!board.text.includes('@'));
});

test('bearer tokens and CORS for builds hosted on other sites', async () => {
  const origin = 'https://games.crazygames.com';
  const pre = await new Client().request('OPTIONS', '/api/login', undefined, { origin, 'access-control-request-method': 'POST' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), origin);
  assert.equal(pre.headers.get('access-control-allow-credentials'), null, 'never credentialed');
  assert.equal((await new Client().request('OPTIONS', '/api/login', undefined, { origin: 'https://evil.example' })).status, 403);

  const c = new Client();
  const reg = await c.post('/api/register', { name: 'Ivy_10', password: 'password123', token: true }, { origin });
  assert.equal(reg.status, 201);
  assert.equal(reg.headers.get('access-control-allow-origin'), origin);
  const auth = { authorization: `Bearer ${reg.json.token}`, origin };
  const me = await new Client().get('/api/me', auth);
  assert.equal(me.json.user.name, 'Ivy_10');
  assert.equal((await new Client().post('/api/register', { name: 'Ivy_11', password: 'password123' }, { origin: 'https://evil.example' })).status, 403);
});

function cgToken(payload, key = cgKeys.privateKey) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(payload)}`;
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

test('CrazyGames users are signed in automatically and linked to one account', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const c = new Client();
  const first = await c.post('/api/auth/crazygames', { token: cgToken({ userId: 'cg-123', username: 'Cool.Kid!', exp }), wantToken: true });
  assert.equal(first.status, 200);
  assert.equal(first.json.user.name, 'CoolKid');
  assert.ok(first.json.token);
  const me = (await c.get('/api/me')).json.user;
  assert.equal(me.platform, 'crazygames');
  assert.equal(me.hasPassword, false);
  // same CrazyGames user later -> same account; a taken name gets a number
  const again = await new Client().post('/api/auth/crazygames', { token: cgToken({ userId: 'cg-123', username: 'Renamed', exp }) });
  assert.equal(again.json.user.name, 'CoolKid');
  const other = await new Client().post('/api/auth/crazygames', { token: cgToken({ userId: 'cg-999', username: 'CoolKid', exp }) });
  assert.match(other.json.user.name, /^CoolKid\d{5}$/);
  // forged, expired and garbage tokens are refused; platform accounts can't log in with a password
  const forged = cgToken({ userId: 'cg-1', username: 'x', exp }, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey);
  assert.equal((await new Client().post('/api/auth/crazygames', { token: forged })).status, 401);
  assert.equal((await new Client().post('/api/auth/crazygames', { token: cgToken({ userId: 'cg-1', exp: 1 }) })).status, 401);
  assert.equal((await new Client().post('/api/auth/crazygames', { token: 'abc' })).status, 401);
  assert.equal((await new Client().post('/api/login', { name: 'CoolKid', password: '!' })).status, 401);
  assert.equal((await c.post('/api/account/delete', { confirmName: 'wrong' })).status, 403);
});

/** Collect chat events from the SSE stream until `count` messages arrived. */
async function readChat(count) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/chat/stream`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader(), dec = new TextDecoder(), events = [];
  let buf = '';
  const done = (async () => {
    while (events.filter((e) => e.event === 'message').length < count) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block), data = /^data: (.+)$/m.exec(block);
        if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    }
    ctrl.abort();
    return events;
  })();
  return { done };
}

test('chat: signed-in players talk, guests read, messages are filtered and rate limited', async () => {
  const { resetChat } = await import('../server/chat.js');
  const { q } = await import('../server/db.js');
  resetChat();
  const listener = await readChat(2);
  const guest = new Client();
  assert.equal((await guest.post('/api/chat/send', { text: 'hi' })).status, 401);

  const c = new Client();
  await c.post('/api/register', { name: 'Jade_12', password: 'password123' });
  const sent = await c.post('/api/chat/send', { text: 'gg everyone', mode: 'sumo' });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.message.name, 'Jade_12');
  assert.equal(sent.json.message.mode, 'sumo');
  assert.equal((await c.post('/api/chat/send', { text: 'too fast' })).status, 429);
  await new Promise((r) => setTimeout(r, 1300));
  const filtered = await c.post('/api/chat/send', { text: 'join www.free-stuff.com you shit' });
  assert.equal(filtered.json.message.text, 'join *** you ****');

  const events = await listener.done;
  assert.equal(events[0].event, 'history');
  assert.deepEqual(events.filter((e) => e.event === 'message').map((e) => e.data.text), ['gg everyone', 'join *** you ****']);

  assert.equal((await c.post('/api/chat/send', { text: 'x'.repeat(101) })).status, 400);
  // staff can mute; muted players can't talk; regular players can't use commands
  assert.match((await c.post('/api/chat/send', { text: '/mute Jade_12 5' })).json.system, /Only staff/);
  const mod = new Client();
  await mod.post('/api/register', { name: 'Kai_13', password: 'password123' });
  q.setStaffRank.run('MOD', q.userByName.get('Kai_13').id);
  assert.match((await mod.post('/api/chat/send', { text: '/mute Jade_12 5' })).json.system, /muted for 5 minutes/);
  await new Promise((r) => setTimeout(r, 1300));
  const muted = await c.post('/api/chat/send', { text: 'hello?' });
  assert.equal(muted.status, 403);
  assert.match(muted.json.error, /muted/);
  await mod.post('/api/chat/send', { text: '/unmute Jade_12' });
  assert.equal((await c.post('/api/chat/send', { text: 'thanks' })).status, 200);
});
