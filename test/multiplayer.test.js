// Multiplayer: real WebSocket clients against the game server. Run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brickfall-mp-'));
process.env.DATA_DIR = dataDir;
process.env.RATE_LIMIT_SCALE = '100';
process.env.LOG_REQUESTS = '0';
process.env.ROOM_FIGHTERS = '0'; // no bots: only the test players are in the room

const { createServer } = await import('../server/index.js');
const { closeDb, q } = await import('../server/db.js');
const { closeRooms, setRoomFighters } = await import('../server/game/rooms.js');
const world = await import('../public/js/world/world.js');

let server, base, wsBase;

before(() => new Promise((resolve) => {
  server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  closeRooms();
  server.close(() => { closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); });
  server.closeAllConnections?.();
}));

/** A scripted player: connects, collects messages, waits for specific ones. */
class Player {
  constructor() { this.msgs = []; this.waiters = []; }
  connect(hello) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsBase}/ws`);
      this.ws.onerror = reject;
      this.ws.onopen = () => this.send({ t: 'hello', ...hello });
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        const w = this.waiters.find((x) => x.match(m));
        if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); } else this.msgs.push(m);
        if (m.t === 'welcome') { this.id = m.you; resolve(m); }
      };
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  next(match, ms = 3000) {
    const found = this.msgs.find(match);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      this.waiters.push(w);
      setTimeout(() => { if (this.waiters.includes(w)) reject(new Error('timed out waiting for a message')); }, ms);
    });
  }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp(name) {
  const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'password123', token: true }) });
  return (await r.json()).token;
}

/** A flat standing spot on the arena floor, away from the spawn tower. */
function groundSpot() {
  const w = world.newWorld();
  world.useWorld(w);
  world.generateWorld('arena');
  for (let x = 10; x < 54; x++) {
    for (let z = 10; z < 54; z++) {
      if (Math.hypot(x - 32, z - 32) < 12) continue;
      const y = world.topY(x, z);
      if ([1, 2, 3].every((dx) => world.topY(x + dx, z) === y)) return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  throw new Error('no flat spot');
}

test('two players share a room, fight, and the kill is saved', async () => {
  const token = await signUp('Mia_01');
  const a = new Player(), b = new Player();
  const wa = await a.connect({ mode: 'arena', token });
  assert.equal(wa.name, 'Mia_01', 'signed in through the token');
  assert.equal(wa.mode, 'arena');
  const wb = await b.connect({ mode: 'arena', name: 'Mia_01' });
  assert.notEqual(wb.name, 'Mia_01', "a guest can't take a registered player's name");
  assert.equal(wb.room, wa.room, 'same mode -> same room');
  assert.ok(wb.fighters.some((f) => f.id === a.id && !f.bot));
  await a.next((m) => m.t === 'join' && m.f.id === b.id);
  assert.deepEqual((await (await fetch(`${base}/api/online`)).json()).players, { arena: 2 });

  // both spawn next to each other on flat ground and stream their positions
  const s = groundSpot();
  const pa = [s.x, s.y, s.z], pb = [s.x + 2, s.y, s.z];
  a.send({ t: 'spawn', p: pa });
  b.send({ t: 'spawn', p: pb });
  await sleep(100);
  const state = (p, yaw) => ({ t: 'state', p, v: [0, 0, 0], yaw, pitch: 0, held: 'sword', fl: 8, fd: 0 });
  a.send(state(pa, -Math.PI / 2));
  b.send(state(pb, Math.PI / 2));
  const snap = await a.next((m) => m.t === 's' && m.f.some((f) => f[0] === b.id && Math.abs(f[1] - pb[0]) < 0.01));
  assert.equal(snap.f.length, 2);

  // A hits B: everyone hears about it, only B gets the knockback, and the server picks the damage
  a.send({ t: 'hit', id: b.id, k: 'melee', s: true, d: 999 });
  const hurt = await b.next((m) => m.t === 'hurt' && m.id === b.id);
  assert.equal(hurt.by, a.id);
  assert.equal(hurt.a, 7 * (25 - 12) / 25, 'sword damage after armor, not the client-sent number');
  const kb = await b.next((m) => m.t === 'kb');
  assert.ok(kb.s != null, 'sprint hit adds sprint knockback');
  await a.next((m) => m.t === 'hurt' && m.id === b.id);

  // a second hit inside the hurt-resistance window does nothing
  a.send({ t: 'hit', id: b.id, k: 'melee' });
  await sleep(150);
  assert.ok(!b.msgs.some((m) => m.t === 'hurt'), `still resisting damage: ${JSON.stringify(b.msgs.filter((m) => m.t === 'hurt'))}`);

  // out of reach: ignored
  for (const dx of [6, 10, 14, 15]) { b.send(state([s.x + dx, s.y, s.z], 0)); await sleep(60); } // walk away
  await sleep(1000);
  a.send({ t: 'hit', id: b.id, k: 'melee' });
  await sleep(150);
  assert.ok(!b.msgs.some((m) => m.t === 'hurt'), 'too far away to hit');

  // impossible movement is put back
  b.send(state([s.x + 40, s.y, s.z], 0));
  const fix = await b.next((m) => m.t === 'correct');
  assert.equal(fix.p[0], s.x + 15);

  // B falls into the void: A hit them recently, so A gets the kill
  b.send({ t: 'void' });
  const kill = await a.next((m) => m.t === 'kill');
  assert.equal(kill.v, b.id);
  assert.equal(kill.k, a.id);
  assert.ok(kill.r > 0 && kill.x > 0, 'coins and XP');
  await sleep(50);
  const user = q.userByName.get('Mia_01');
  const lifetime = q.progress.get(user.id);
  assert.equal(lifetime.kills, 1, 'the server saved the kill for the signed-in player');
  const board = await (await fetch(`${base}/api/leaderboard?mode=arena`)).json();
  assert.equal(board.rows[0].name, 'Mia_01');

  // respawning too early is refused; after the timer it works
  const aliveIn = (snap) => !!(snap.f.find((f) => f[0] === b.id)[7] & 16);
  b.send({ t: 'spawn', p: pb });
  await sleep(100);
  a.msgs.length = 0;
  assert.equal(aliveIn(await a.next((m) => m.t === 's')), false, 'too early: still dead');
  // the respawn timer runs on game time, which can lag the wall clock on a busy machine
  const respawned = a.next((m) => m.t === 'spawn' && m.id === b.id, 10000);
  const retry = setInterval(() => b.send({ t: 'spawn', p: pb }), 500);
  await respawned.finally(() => clearInterval(retry));
  const inv = await b.next((m) => m.t === 'inv');
  assert.deepEqual(inv.inv, { arrows: 24, blocks: 32, flasks: 2 }, 'fresh kit');
  a.msgs.length = 0;
  assert.equal(aliveIn(await a.next((m) => m.t === 's')), true);

  b.close();
  await a.next((m) => m.t === 'leave' && m.id === b.id);
  a.close();
});

test('rooms fill with bots and they fight', async () => {
  setRoomFighters(4);
  try {
    const p = new Player();
    const w = await p.connect({ mode: 'sumo', name: 'Botwatcher' });
    // the welcome may arrive before the bots are added; they show up as joins
    const bots = new Set(w.fighters.filter((f) => f.bot).map((f) => f.id));
    while (bots.size < 3) bots.add((await p.next((m) => m.t === 'join' && m.f.bot)).f.id);
    const snap = await p.next((m) => m.t === 's' && m.f.length === 4);
    assert.ok(snap.f.filter((f) => bots.has(f[0])).every((f) => f[7] & 16), 'bots are alive');
    p.close();
  } finally {
    setRoomFighters(0);
  }
});
