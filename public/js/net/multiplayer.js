// Online play: connects to the game server over a WebSocket, shows the other fighters in the room
// (real players and server bots), streams our own movement, and applies what the server decides
// (damage, knockback, kills, respawns, consumables, placed blocks).
import * as THREE from '../vendor/three.js';
import { store } from '../core/util.js';
import { game } from '../core/state.js';
import { events } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { API_BASE, TOKEN_AUTH } from '../core/platform.js';
import { itemAt } from '../render/icons.js';
import { getB } from '../world/world.js';
import { placeBlock, removeBlock, removeAllPlaced } from '../world/placed.js';
import { B } from '../shared/blocks.js';
import { levelFromXp } from '../shared/cosmetics.js';
import { player, bots, fighters, Remote, spawnBot } from '../game/entities.js';
import { knockback, sprintKnockback } from '../game/combat.js';
import { shootArrow, castHook, throwItem, dropHook, splashEffect, clearProjectiles } from '../game/projectiles.js';
import { burst } from '../game/effects.js';
import { drawTag } from '../game/characters.js';
import { net } from './net.js';

const CONNECT_TIMEOUT = 6000;
const PING_EVERY = 2000;
const PLAYER_RESPAWN = 3.5;

export const online = { ping: 0, room: null, players: 0 };
const remotes = new Map(); // server id -> Remote
const offlineBots = []; // our practice bots, parked while we're online
let ws = null, youId = null, pingTimer = 0, swung = false, leaving = false;
const _p = new THREE.Vector3();

function socketUrl() {
  const base = API_BASE || `${location.protocol}//${location.host}`;
  return `${base.replace(/^http/, 'ws')}/ws`;
}

const fighterById = (id) => (id === youId ? player : remotes.get(id) || null);

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------- roster
function addRemote(info) {
  if (info.id === youId || remotes.has(info.id)) return;
  const r = new Remote(info);
  remotes.set(info.id, r);
  bots.push(r);
  fighters.push(r);
}

function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  dropHook(r);
  r.dispose();
  remotes.delete(id);
  bots.splice(bots.indexOf(r), 1);
  fighters.splice(fighters.indexOf(r), 1);
}

/** Our practice bots sit out while we're online (the server has its own). */
function parkOfflineBots() {
  for (const b of [...bots]) {
    if (b.remote) continue;
    b.model.group.visible = false;
    b.alive = false;
    offlineBots.push(b);
    bots.splice(bots.indexOf(b), 1);
    fighters.splice(fighters.indexOf(b), 1);
  }
}

function restoreOfflineBots() {
  for (const b of offlineBots.splice(0)) {
    bots.push(b);
    fighters.push(b);
    spawnBot(b);
  }
}

// ---------------------------------------------------------------- server messages
function onSnapshot(m) {
  const now = performance.now();
  for (const [id, x, y, z, yaw, pitch, held, flags, hp, ab] of m.f) {
    if (id === youId) {
      if (player.alive) { player.hp = hp; player.absorb = ab; }
      continue;
    }
    const r = remotes.get(id);
    if (!r) continue;
    const alive = !!(flags & 16);
    if (alive && !r.alive) { r.prevPos.set(x, y, z); r.pos.set(x, y, z); r.prevYaw = r.yaw = yaw; } // (re)spawned: don't slide in
    r.alive = alive;
    r.model.group.visible = alive;
    r.prevPos.copy(r.pos);
    r.prevYaw = r.yaw;
    r.vel.set(x - r.pos.x, y - r.pos.y, z - r.pos.z); // per update (= per tick), for walk animation
    r.pos.set(x, y, z);
    r.yaw = yaw;
    r.pitch = pitch;
    r.netAt = now;
    r.held = held;
    r.sprinting = !!(flags & 1);
    r.blocking = !!(flags & 2);
    r.drawing = flags & 4 ? 1 : 0;
    r.protectT = flags & 32 ? 1 : 0;
    const swinging = !!(flags & 64);
    if (swinging && !r.netSwing) r.swing = 1;
    r.netSwing = swinging;
    if (r.hp !== hp || r.absorb !== ab) { r.hp = hp; r.absorb = ab; drawTag(r); }
  }
}

function onHurt(m) {
  const victim = fighterById(m.id), attacker = m.by == null ? null : fighterById(m.by);
  if (!victim) return;
  victim.hp = m.hp;
  victim.absorb = m.ab;
  if (m.f) {
    victim.hurtT = 0.5;
    victim.netHurtAt = game.time;
    if (victim === player) {
      sfx('hurt');
      player.hurtAnim = 1;
      const dx = victim.pos.x - (attacker ? attacker.pos.x : victim.pos.x), dz = victim.pos.z - (attacker ? attacker.pos.z : victim.pos.z);
      player.hurtSide = Math.sign(dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) || 1;
    }
    if (m.a > 0) burst(_p.set(victim.pos.x, victim.pos.y + 1.2, victim.pos.z), 0xc4304a, 6, 2.5);
  }
  if (attacker === player) sfx(m.k === 'melee' && player.fallDistance > 0 ? 'crit' : 'hit');
  if (victim.tag) drawTag(victim);
  events.emit('hurt', { victim, attacker, amount: m.a, kind: m.k });
}

function onKill(m) {
  const victim = fighterById(m.v), killer = m.k == null ? null : fighterById(m.k);
  if (!victim) return;
  victim.alive = false;
  victim.deaths = m.vd;
  victim.streak = 0;
  victim.absorb = 0;
  victim.regenT = 0;
  if (victim === player) player.respawnT = PLAYER_RESPAWN;
  else victim.model.group.visible = false;
  burst(_p.set(victim.pos.x, victim.pos.y + 1, victim.pos.z), 0xffffff, 14, 4, 1.4);
  let levelUp = 0;
  if (killer) {
    killer.kills = m.kk;
    killer.streak = m.ks;
    killer.best = m.kb;
    killer.lastAttacker = null;
    if (killer === player) {
      player.coins += m.r;
      const before = levelFromXp(player.xp).level;
      player.xp += m.x;
      player.level = levelFromXp(player.xp).level;
      if (player.level > before) levelUp = player.level;
    }
  }
  events.emit('kill', { killer, victim, kind: m.kind, reward: m.r, xp: m.x, endedStreak: m.es });
  if (levelUp) events.emit('levelUp', { level: levelUp });
}

function onProjectile(m) {
  const owner = remotes.get(m.id);
  if (!owner) return;
  const p = new THREE.Vector3(...m.p), v = new THREE.Vector3(...m.v);
  if (m.k === 'arrow') { shootArrow(owner, p, v, { crit: !!m.c, visual: true }); sfx('bow'); }
  else if (m.k === 'hook') { dropHook(owner); owner.hook = castHook(owner, p, v, { visual: true }); }
  else throwItem(owner, m.k, p, v, { visual: true });
}

function onBlock(m) {
  if (m.b) { if (!getB(m.x, m.y, m.z)) placeBlock(m.x, m.y, m.z, m.b); }
  else if (getB(m.x, m.y, m.z)) removeBlock(m.x, m.y, m.z);
}

function onMessage(e) {
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  switch (m.t) {
    case 's': onSnapshot(m); break;
    case 'join': addRemote(m.f); events.emit('roster'); break;
    case 'leave': removeRemote(m.id); events.emit('roster'); break;
    case 'hurt': onHurt(m); break;
    case 'kb':
      knockback(player, m.x, m.z);
      if (m.s != null) sprintKnockback(player, m.s);
      break;
    case 'pull': player.vel.x += m.v[0]; player.vel.y += m.v[1]; player.vel.z += m.v[2]; break;
    case 'kill': onKill(m); break;
    case 'spawn': { const r = remotes.get(m.id); if (r) { r.alive = true; r.netAt = 0; } break; }
    case 'inv': player.inv = { ...m.inv }; break;
    case 'lvl': { const r = remotes.get(m.id); if (r) { r.level = m.l; drawTag(r); } break; }
    case 'proj': onProjectile(m); break;
    case 'reel': { const r = remotes.get(m.id); if (r) dropHook(r); break; }
    case 'fx': if (m.k === 'splash') splashEffect(_p.set(...m.p)); break;
    case 'blk': onBlock(m); break;
    case 'correct': player.pos.set(...m.p); player.prevPos.copy(player.pos); player.vel.set(0, 0, 0); break;
    case 'pong': online.ping = Math.round(performance.now() - m.n); break;
    case 'kicked': events.emit('netKicked', { reason: m.reason }); break;
    default:
  }
}

// ---------------------------------------------------------------- connect / leave
/**
 * Join an online room for the current mode. Resolves with the welcome message, or rejects if the
 * server can't be reached (the caller falls back to offline practice).
 */
export function joinOnline({ name, cosmetics }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    try { ws = new WebSocket(socketUrl()); } catch (err) { fail(err); return; }
    const timer = setTimeout(() => { fail(new Error('timeout')); try { ws.close(); } catch { /* closed */ } }, CONNECT_TIMEOUT);
    ws.onopen = () => {
      const token = TOKEN_AUTH ? store.get('bf_token', null) : null;
      send({ t: 'hello', mode: game.mode, name, cos: cosmetics, token });
    };
    ws.onerror = () => fail(new Error('connection failed'));
    ws.onclose = () => {
      clearTimeout(timer);
      fail(new Error('closed'));
      if (settled && net.online && !leaving) events.emit('netLost');
      net.online = false;
    };
    ws.onmessage = (e) => {
      if (settled) { onMessage(e); return; }
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'welcome') return;
      settled = true;
      clearTimeout(timer);
      youId = m.you;
      online.room = m.room;
      leaving = false;
      clearProjectiles();
      removeAllPlaced();
      parkOfflineBots();
      for (const f of m.fighters) addRemote(f);
      for (const [x, y, z] of m.blocks) placeBlock(x, y, z, B.PLANKS);
      player.name = m.name;
      player.inv = { ...m.inv };
      net.online = true;
      net.send = send;
      ws.onmessage = onMessage;
      pingTimer = setInterval(() => send({ t: 'ping', n: performance.now() }), PING_EVERY);
      resolve(m);
    };
  });
}

/** Leave the room and bring back offline play. */
export function leaveOnline() {
  if (!ws) return;
  leaving = true;
  clearInterval(pingTimer);
  try { ws.close(); } catch { /* already closed */ }
  ws = null;
  net.online = false;
  net.send = () => {};
  for (const id of [...remotes.keys()]) removeRemote(id);
  clearProjectiles();
  removeAllPlaced();
  restoreOfflineBots();
}

/** Called once per game tick while online: stream our movement to the server. */
export function tickOnline() {
  if (!net.online || !player.alive) return;
  const P = player, r = (n) => Math.round(n * 1000) / 1000;
  const fl = (P.sprinting ? 1 : 0) | (P.blocking ? 2 : 0) | (P.bowT > 0 ? 4 : 0) | (P.onGround ? 8 : 0) | (swung ? 64 : 0);
  swung = false;
  send({ t: 'state', p: [r(P.pos.x), r(P.pos.y), r(P.pos.z)], v: [r(P.vel.x), r(P.vel.y), r(P.vel.z)], yaw: r(P.yaw), pitch: r(P.pitch), held: itemAt(P.slot), fl, fd: r(P.fallDistance) });
}

// tell the server where we (re)spawned
events.on('respawn', () => { if (net.online) send({ t: 'spawn', p: [player.pos.x, player.pos.y, player.pos.z] }); });
events.on('swing', () => { swung = true; });
events.on('localProjectile', ({ kind, p, v, crit }) => send({ t: 'proj', k: kind, p: [p.x, p.y, p.z], v: [v.x, v.y, v.z], c: crit ? 1 : 0 }));

/** Is this fighter a server bot (for the player list)? */
export const isNetBot = (f) => !!f.isBot;
