// Online rooms. Each game mode has rooms of up to MAX_PLAYERS real players, topped up with server
// bots so a room never feels empty (bots leave as players join).
//
// Authority: every player moves their own character (so movement feels instant) and streams its
// position here; the server sanity-checks those moves. Everything that decides fights lives here:
// health, hurt resistance, damage, armor, knockback direction, kills, rewards, consumables and
// respawn timing. Players only *claim* hits; the server checks range and applies the 1.8.9 rules.
// Kills, deaths, coins and XP of signed-in players are written to the database right here.
import { RULES } from '../../public/js/game/rules.js';
import { isMode } from '../../public/js/shared/modes.js';
import { inSafeZone, TICK } from '../../public/js/game/physics.js';
import {
  newWorld, useWorld, generateWorld, spawnPoint, getB, setB, map, W, H, D, CX, CZ, SPAWN_TOP,
} from '../../public/js/world/world.js';
import { B } from '../../public/js/shared/blocks.js';
import { rankById, killXp, levelFromXp, displayRank, sanitizeCosmetics, DEFAULT_COSMETICS } from '../../public/js/shared/cosmetics.js';
import { q } from '../db.js';
import { periodKeys } from '../leaderboard.js';
import { log } from '../log.js';
import { config } from '../config.js';
import { botName, botLooks, initBotBrain, tickBot } from './bots.js';

export const MAX_PLAYERS = 12;
const PLAYER_RESPAWN = 3.5, BOT_RESPAWN = 3;
const ASSIST_WINDOW = 8;
const MELEE_SLACK = 2.2; // extra reach allowed for latency (server positions lag the client a little)
const MAX_STEP = 4.5; // most a player may move between two position updates (blocks)
const BLOCK_LIFE = 45, BUILD_REACH = 6;
const NATURAL_REGEN = 4, REGEN_II = 1.25;
const SPRINT_KB = 0.5, SPRINT_KB_UP = 0.1;
const ENVIRONMENT = new Set(['fall', 'void', 'pearl']);
const MAX_MSGS_PER_SEC = 80;

const rooms = new Map(); // id -> Room
let roomFighters = config.roomFighters;

/** Change how many fighters bots fill rooms up to (tests). */
export function setRoomFighters(n) { roomFighters = n; }
let nextRoomId = 1, nextFighterId = 1, loop = null;

const finite = (...v) => v.every((n) => typeof n === 'number' && Number.isFinite(n));
const vec = (a) => (Array.isArray(a) && a.length === 3 && finite(...a) ? { x: a[0], y: a[1], z: a[2] } : null);
const r2 = (n) => Math.round(n * 100) / 100;
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function newFighter(props) {
  return {
    id: nextFighterId++, pos: { x: CX, y: SPAWN_TOP, z: CZ }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, w: 0.6, h: 1.8,
    hp: 20, maxHp: 20, absorb: 0, regenT: 0, regenAcc: 0, foodT: 0, iframe: 0, lastDmg: 0, lastAttacker: null, lastHitT: -99,
    protectT: 0, alive: false, diedAt: -99, respawnT: 0, kills: 0, deaths: 0, streak: 0, best: 0, coins: 0, xp: 0,
    held: 'sword', blocking: false, sprinting: false, fallDistance: 0, onGround: false, inv: {}, ...props,
  };
}

const publicInfo = (f) => ({ id: f.id, name: f.name, rank: f.rank, level: f.level, cos: f.cosmetics, bot: !!f.bot, kills: f.kills, deaths: f.deaths, streak: f.streak, alive: f.alive });

class Room {
  constructor(mode) {
    this.id = nextRoomId++;
    this.mode = mode;
    this.rules = RULES[mode];
    this.world = newWorld();
    useWorld(this.world);
    generateWorld(this.rules.map);
    this.fighters = new Map();
    this.placed = new Map(); // "x,y,z" -> expiry time
    this.time = 0;
    this.blockTimer = 0;
  }

  get humans() { let n = 0; for (const f of this.fighters.values()) if (f.human) n++; return n; }

  broadcast(msg, except = null) {
    const text = JSON.stringify(msg);
    for (const f of this.fighters.values()) if (f.human && f !== except) f.conn.send(text);
  }

  /** A spawn point away from everyone (the world must be active). */
  spawnPoint(self = null) {
    let best = null, bestD = -1;
    for (let i = 0; i < 10; i++) {
      const p = spawnPoint();
      let d = Infinity;
      for (const f of this.fighters.values()) if (f !== self && f.alive) d = Math.min(d, dist3(f.pos, p));
      if (d > bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // ------------------------------------------------------------ bots
  balanceBots() {
    const want = Math.max(0, roomFighters - this.humans); // bots fill the room up to this many fighters
    const bots = [...this.fighters.values()].filter((f) => f.bot);
    for (let i = bots.length; i < want; i++) this.addBot();
    for (let i = want; i < bots.length; i++) {
      // remove idle bots first
      const b = bots.sort((a, c) => (a.target ? 1 : 0) - (c.target ? 1 : 0))[0];
      bots.splice(bots.indexOf(b), 1);
      this.remove(b);
    }
  }

  addBot() {
    const looks = botLooks();
    const b = newFighter({ bot: true, name: botName((n) => this.nameTaken(n)), rank: looks.rank, level: looks.level, cosmetics: looks.cosmetics });
    initBotBrain(b);
    this.fighters.set(b.id, b);
    this.respawnBot(b);
    this.broadcast({ t: 'join', f: publicInfo(b) });
  }

  respawnBot(b) {
    useWorld(this.world);
    const kit = this.rules.bot, p = this.spawnPoint(b);
    Object.assign(b, {
      pos: { ...p }, vel: { x: 0, y: 0, z: 0 }, yaw: Math.random() * Math.PI * 2, hp: 20, absorb: 0, regenT: 0, alive: true,
      fallDistance: 0, landedFrom: 0, iframe: 0, target: null, wanderTo: null, protectT: this.rules.protect || 0,
      held: kit.weapon, inv: { pots: kit.pots || 0, flasks: kit.flasks || 0 }, potCd: 0, drinkT: 0, retreatT: 0,
      speedT: kit.speed ? 1e9 : 0, speedLevel: kit.speed ? 2 : 0,
    });
  }

  nameTaken(name) {
    const n = name.toLowerCase();
    for (const f of this.fighters.values()) if (f.name.toLowerCase() === n) return true;
    return false;
  }

  remove(f) {
    this.fighters.delete(f.id);
    for (const o of this.fighters.values()) { if (o.lastAttacker === f) o.lastAttacker = null; if (o.target === f) o.target = null; }
    this.broadcast({ t: 'leave', id: f.id });
  }

  // ------------------------------------------------------------ combat
  heal(f, amount) {
    if (!f.alive || f.hp >= f.maxHp || amount <= 0) return;
    f.hp = Math.min(f.maxHp, f.hp + amount);
  }

  /** The 1.8.9 damage rules (see public/js/game/combat.js). Returns true if the hit registered. */
  damage(victim, raw, attacker, kind, { sprint = false } = {}) {
    if (!victim.alive) return false;
    const R = this.rules, env = ENVIRONMENT.has(kind);
    useWorld(this.world);
    if (!env) {
      if (!attacker?.alive || inSafeZone(victim) || inSafeZone(attacker) || victim.protectT > 0) return false;
      attacker.protectT = 0;
    }
    let amount = raw, fresh = true;
    if (victim.iframe > R.hurtResistance / 2) {
      if (amount <= victim.lastDmg) return false;
      const full = amount;
      amount -= victim.lastDmg;
      victim.lastDmg = full;
      fresh = false;
    } else {
      victim.lastDmg = amount;
      victim.iframe = R.hurtResistance;
    }
    let dmg = amount;
    if (!env) {
      if (victim.blocking && dmg > 0) dmg = (1 + dmg) * 0.5;
      dmg = (dmg * (25 - R.armor)) / 25;
    }
    if (victim.absorb > 0) { const soak = Math.min(victim.absorb, dmg); victim.absorb -= soak; dmg -= soak; }
    victim.hp -= dmg;
    if (attacker) { victim.lastAttacker = attacker; victim.lastHitT = this.time; }

    if (attacker && !env && fresh) {
      const sprintYaw = sprint ? attacker.yaw : null;
      if (victim.human) victim.conn.send({ t: 'kb', x: r2(attacker.pos.x), z: r2(attacker.pos.z), s: sprintYaw == null ? null : r2(sprintYaw) });
      else this.knockback(victim, attacker.pos.x, attacker.pos.z, sprintYaw);
      if (sprint && attacker.bot) { attacker.vel.x *= 0.6; attacker.vel.z *= 0.6; attacker.sprinting = false; }
    }
    this.broadcast({ t: 'hurt', id: victim.id, by: attacker?.id ?? null, k: kind, a: r2(dmg), hp: r2(Math.max(0, victim.hp)), ab: r2(victim.absorb), f: fresh ? 1 : 0 });
    if (victim.hp <= 0) { victim.hp = 0; this.kill(victim, attacker, kind); }
    return true;
  }

  knockback(v, fromX, fromZ, sprintYaw) {
    const [KB, KB_UP] = this.rules.knockback;
    let dx = fromX - v.pos.x, dz = fromZ - v.pos.z;
    while (dx * dx + dz * dz < 1e-4) { dx = (Math.random() - Math.random()) * 0.01; dz = (Math.random() - Math.random()) * 0.01; }
    const d = Math.hypot(dx, dz);
    v.vel.x = v.vel.x / 2 - (dx / d) * KB;
    v.vel.y = Math.min(KB_UP, v.vel.y / 2 + KB_UP);
    v.vel.z = v.vel.z / 2 - (dz / d) * KB;
    if (sprintYaw != null) {
      v.vel.x -= Math.sin(sprintYaw) * SPRINT_KB;
      v.vel.z -= Math.cos(sprintYaw) * SPRINT_KB;
      v.vel.y += SPRINT_KB_UP;
    }
    v.onGround = false;
  }

  kill(victim, attacker, kind) {
    const R = this.rules;
    victim.alive = false;
    victim.diedAt = this.time;
    victim.deaths++;
    const endedStreak = victim.streak, bounty = endedStreak >= 5 ? endedStreak * 3 : 0;
    victim.streak = 0;
    victim.absorb = 0;
    victim.regenT = 0;
    victim.respawnT = victim.bot ? BOT_RESPAWN : PLAYER_RESPAWN;

    let killer = attacker && attacker !== victim ? attacker : null;
    if (!killer && victim.lastAttacker && this.fighters.has(victim.lastAttacker.id) && this.time - victim.lastHitT < ASSIST_WINDOW) killer = victim.lastAttacker;
    let reward = 0, xp = 0;
    if (killer) {
      killer.kills++;
      killer.streak++;
      killer.best = Math.max(killer.best, killer.streak);
      reward = Math.round((10 + Math.min(killer.streak, 10) * 2 + bounty) * (1 + rankById(killer.rank).coinBonus));
      killer.coins += reward;
      xp = killXp(killer.streak);
      const before = levelFromXp(killer.xp).level;
      killer.xp += xp;
      killer.level = killer.human ? levelFromXp(killer.xp).level : killer.level;
      killer.lastAttacker = null;
      for (const [k, [amount, cap]] of Object.entries(R.killRefill)) killer.inv[k] = Math.min(cap, (killer.inv[k] || 0) + amount);
      if (killer.bot) {
        if (R.bot.pots) killer.inv.pots = Math.min(R.bot.pots, (killer.inv.pots || 0) + 6);
        if (R.bot.flasks) killer.inv.flasks = Math.min(R.bot.flasks, (killer.inv.flasks || 0) + 2);
      }
      this.heal(killer, R.killHeal);
      if (killer.human) {
        killer.conn.send({ t: 'inv', inv: killer.inv });
        if (killer.level !== before) this.broadcast({ t: 'lvl', id: killer.id, l: killer.level });
      }
    }
    this.broadcast({
      t: 'kill', v: victim.id, k: killer?.id ?? null, kind, r: reward, x: xp, es: endedStreak,
      ks: killer?.streak ?? 0, kk: killer?.kills ?? 0, kb: killer?.best ?? 0, vd: victim.deaths,
    });
    this.save(killer, { kills: 1, coins: reward, xp, best: killer?.best || 0 });
    this.save(victim, { deaths: 1 });
  }

  /** Add to a signed-in player's stats for this mode (lifetime, this week, today). */
  save(f, { kills = 0, deaths = 0, coins = 0, xp = 0, best = 0, seconds = 0 }) {
    if (!f?.user) return;
    const now = Date.now();
    try {
      for (const period of periodKeys(now)) q.addStats.run(f.user.id, this.mode, period, kills, deaths, best, coins, xp, seconds, now);
    } catch (err) {
      log.error('could not save stats', { error: String(err) });
    }
  }

  // ------------------------------------------------------------ player messages
  onMessage(f, m) {
    const R = this.rules;
    useWorld(this.world);
    switch (m.t) {
      case 'state': {
        if (!f.alive) return;
        const p = vec(m.p), v = vec(m.v);
        if (!p || !v || !finite(m.yaw, m.pitch)) return;
        const limit = f.teleportOk ? 70 : MAX_STEP;
        if (dist3(p, f.pos) > limit || p.x < -40 || p.x > W + 40 || p.z < -40 || p.z > D + 40 || p.y > H + 40) {
          f.conn.send({ t: 'correct', p: [f.pos.x, f.pos.y, f.pos.z] }); // impossible move: put them back
          return;
        }
        f.teleportOk = false;
        f.pos = p;
        f.vel = v;
        f.yaw = m.yaw;
        f.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
        f.held = typeof m.held === 'string' && R.kit.includes(m.held) ? m.held : R.kit[0];
        const fl = m.fl | 0;
        f.sprinting = !!(fl & 1);
        f.blocking = !!(fl & 2) && f.held === 'sword';
        f.drawing = !!(fl & 4);
        f.onGround = !!(fl & 8);
        f.fallDistance = finite(m.fd) ? Math.max(0, m.fd) : 0;
        if (fl & 64) f.swingT = this.time;
        if (f.pos.y < map.killY) this.kill(f, null, 'void');
        return;
      }
      case 'hit': {
        const target = this.fighters.get(m.id);
        if (!f.alive || !target || target === f || !target.alive) return;
        const now = this.time;
        f.hits = (f.hits || []).filter((t) => now - t < 1);
        if (f.hits.length >= 20) return; // nobody clicks this fast
        f.hits.push(now);
        const kind = m.k === 'arrow' || m.k === 'rod' ? m.k : 'melee';
        const range = kind === 'melee' ? 3 + MELEE_SLACK : 70;
        if (dist3(f.pos, target.pos) > range) return;
        let amount;
        if (kind === 'melee') amount = (f.held === 'sword' ? R.swordDamage : R.fistDamage) * (m.c && !f.onGround && f.fallDistance > 0 ? 1.5 : 1);
        else if (kind === 'arrow') amount = R.kit.includes('bow') ? Math.max(0, Math.min(10, Number(m.d) || 0)) : 0;
        else amount = 0;
        this.damage(target, amount, f, kind, { sprint: kind === 'melee' && !!m.s });
        return;
      }
      case 'pull': { // fishing rod reel-in
        const target = this.fighters.get(m.id), v = vec(m.v);
        if (!target || !v || !R.kit.includes('rod') || dist3(f.pos, target.pos) > 34) return;
        const len = Math.hypot(v.x, v.y, v.z), s = len > 3 ? 3 / len : 1;
        if (target.human) target.conn.send({ t: 'pull', v: [v.x * s, v.y * s, v.z * s] });
        else { target.vel.x += v.x * s; target.vel.y += v.y * s; target.vel.z += v.z * s; }
        return;
      }
      case 'proj': { // something thrown or shot: others draw it
        const p = vec(m.p), v = vec(m.v);
        if (!f.alive || !p || !v || !['arrow', 'hook', 'splash', 'pearl'].includes(m.k)) return;
        this.broadcast({ t: 'proj', id: f.id, k: m.k, p: m.p, v: m.v, c: m.c ? 1 : 0 }, f);
        return;
      }
      case 'reel': this.broadcast({ t: 'reel', id: f.id }, f); return;
      case 'splash': {
        const p = vec(m.p);
        if (!f.alive || !p || !R.kit.includes('splash') || !(f.inv.pots > 0) || dist3(p, f.pos) > 30) return;
        f.inv.pots--;
        const direct = this.fighters.get(m.d) || null;
        for (const o of this.fighters.values()) {
          if (!o.alive || Math.abs(o.pos.y - p.y) > 2 + o.h) continue;
          const d = dist3(o.pos, p);
          if (d >= 4 && o !== direct) continue;
          this.heal(o, Math.floor((o === direct ? 1 : 1 - d / 4) * 8 + 0.5));
        }
        this.broadcast({ t: 'fx', k: 'splash', p: [p.x, p.y, p.z] }, f);
        return;
      }
      case 'drink': {
        const key = m.k === 'flask' ? 'flasks' : m.k === 'speed' ? 'speed' : null;
        if (!f.alive || !key || !R.kit.includes(m.k) || !(f.inv[key] > 0)) return;
        f.inv[key]--;
        if (m.k === 'flask') { f.regenT = 5; f.regenAcc = 0; f.absorb = 4; }
        return;
      }
      case 'pearl': {
        const p = vec(m.p);
        if (!f.alive || !p || !R.kit.includes('pearl') || !(f.inv.pearls > 0) || dist3(p, f.pos) > 64) return;
        f.inv.pearls--;
        f.pos = p;
        f.teleportOk = true;
        this.damage(f, 5, null, 'pearl');
        return;
      }
      case 'env': { // fall damage the player's own physics noticed
        if (!f.alive || m.k !== 'fall' || !R.fallDamage) return;
        this.damage(f, Math.max(0, Math.min(20, Number(m.a) || 0)), null, 'fall');
        return;
      }
      case 'void': if (f.alive) this.kill(f, null, 'void'); return;
      case 'spawn': {
        const p = vec(m.p);
        if (f.alive || !p || this.time - f.diedAt < PLAYER_RESPAWN - 0.6) return;
        Object.assign(f, {
          alive: true, pos: p, vel: { x: 0, y: 0, z: 0 }, hp: 20, absorb: 0, regenT: 0, iframe: 0, lastAttacker: null,
          protectT: R.protect || 0, inv: { ...R.inventory }, teleportOk: false,
        });
        f.conn.send({ t: 'inv', inv: f.inv });
        this.broadcast({ t: 'spawn', id: f.id }, f);
        return;
      }
      case 'place': case 'break': this.blockEdit(f, m); return;
      case 'ping': f.conn.send({ t: 'pong', n: m.n }); return;
      default:
    }
  }

  blockEdit(f, m) {
    const x = m.x | 0, y = m.y | 0, z = m.z | 0, key = `${x},${y},${z}`, R = this.rules;
    const reject = () => f.conn.send({ t: 'blk', x, y, z, b: getB(x, y, z), fix: 1 });
    if (!f.alive || !R.kit.includes('blocks') || dist3({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { x: f.pos.x, y: f.pos.y + 1.6, z: f.pos.z }) > BUILD_REACH) return reject();
    if (m.t === 'place') {
      if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1 || y < 1 || y >= H - 1 || getB(x, y, z)) return reject();
      if (map.tower && y >= SPAWN_TOP - 2 && Math.hypot(x + 0.5 - CX, z + 0.5 - CZ) < 7.5) return reject();
      for (const o of this.fighters.values()) {
        if (o.alive && x + 1 > o.pos.x - 0.3 && x < o.pos.x + 0.3 && y + 1 > o.pos.y && y < o.pos.y + 1.8 && z + 1 > o.pos.z - 0.3 && z < o.pos.z + 0.3) return reject();
      }
      setB(x, y, z, B.PLANKS);
      this.placed.set(key, this.time + BLOCK_LIFE);
      this.broadcast({ t: 'blk', x, y, z, b: B.PLANKS }, f);
    } else {
      if (!this.placed.has(key)) return reject();
      setB(x, y, z, 0);
      this.placed.delete(key);
      this.broadcast({ t: 'blk', x, y, z, b: 0 }, f);
    }
    return undefined;
  }

  // ------------------------------------------------------------ simulation
  tick() {
    useWorld(this.world);
    this.time += TICK;
    const R = this.rules;
    for (const f of this.fighters.values()) {
      f.iframe -= TICK;
      f.protectT -= TICK;
      if (f.bot) {
        tickBot(this, f, {
          hit: (a, v, o) => this.damage(v, R.botDamage * (o.crit ? 1.5 : 1), a, 'melee', { sprint: o.sprint }),
          heal: (x, n) => this.heal(x, n),
          respawn: (b) => { this.respawnBot(b); this.broadcast({ t: 'spawn', id: b.id }); },
        });
        if (f.alive && R.fallDamage && f.landedFrom > 3 && !f.fallFromSafe) this.damage(f, Math.ceil(f.landedFrom - 3), null, 'fall');
        if (f.alive && f.pos.y < map.killY) this.kill(f, null, 'void');
      }
      if (!f.alive) continue;
      f.foodT += TICK;
      if (f.foodT >= NATURAL_REGEN) { f.foodT = 0; if (R.naturalRegen) this.heal(f, 1); }
      if (f.regenT > 0) {
        f.regenT -= TICK;
        f.regenAcc += TICK;
        if (f.regenAcc >= REGEN_II) { f.regenAcc -= REGEN_II; this.heal(f, 1); }
      }
    }
    // placed blocks crumble
    this.blockTimer -= TICK;
    if (this.blockTimer <= 0) {
      this.blockTimer = 0.5;
      for (const [key, expires] of this.placed) {
        if (this.time < expires) continue;
        const [x, y, z] = key.split(',').map(Number);
        setB(x, y, z, 0);
        this.placed.delete(key);
        this.broadcast({ t: 'blk', x, y, z, b: 0 });
      }
    }
    this.snapshot();
  }

  snapshot() {
    const f = [];
    for (const o of this.fighters.values()) {
      const swinging = this.time - (o.swingT ?? -9) < 0.25;
      const flags = (o.sprinting ? 1 : 0) | (o.blocking ? 2 : 0) | (o.drawing ? 4 : 0) | (o.alive ? 16 : 0) | (o.protectT > 0 ? 32 : 0) | (swinging ? 64 : 0);
      f.push([o.id, r2(o.pos.x), r2(o.pos.y), r2(o.pos.z), r2(o.yaw), r2(o.pitch), o.held, flags, r2(o.hp), r2(o.absorb)]);
    }
    this.broadcast({ t: 's', time: r2(this.time), f });
  }

  // ------------------------------------------------------------ joining / leaving
  addPlayer(conn, { user, name, rank, level, xp, cosmetics }) {
    const f = newFighter({ human: true, conn, user, name, rank, level, xp, cosmetics, joinedAt: Date.now(), inv: { ...this.rules.inventory } });
    useWorld(this.world);
    const p = this.spawnPoint(f);
    f.pos = map.tower ? { x: CX + 0.5, y: SPAWN_TOP, z: CZ + 0.5 } : p;
    this.fighters.set(f.id, f);
    conn.send({
      t: 'welcome', you: f.id, room: this.id, mode: this.mode, name: f.name,
      fighters: [...this.fighters.values()].map(publicInfo),
      blocks: [...this.placed.keys()].map((k) => k.split(',').map(Number)),
      inv: f.inv,
    });
    this.broadcast({ t: 'join', f: publicInfo(f) }, f);
    this.balanceBots();
    return f;
  }

  removePlayer(f) {
    if (!this.fighters.has(f.id)) return;
    this.save(f, { seconds: Math.round((Date.now() - f.joinedAt) / 1000) });
    this.remove(f);
    if (this.humans === 0) rooms.delete(this.id);
    else this.balanceBots();
  }
}

// ---------------------------------------------------------------- public API
function tickAll() {
  for (const room of rooms.values()) {
    try { room.tick(); } catch (err) { log.error('room tick failed', { room: room.id, error: err.stack || String(err) }); }
  }
}

/** Put a connected player into a room for `mode`. Returns { room, fighter }. */
export function joinRoom(conn, mode, profile) {
  if (!isMode(mode)) mode = 'arena';
  let room = [...rooms.values()].find((r) => r.mode === mode && r.humans < MAX_PLAYERS);
  if (!room) {
    room = new Room(mode);
    rooms.set(room.id, room);
  }
  // keep names unique inside the room
  let name = profile.name;
  while (room.nameTaken(name)) name = `${profile.name.slice(0, 12)}${Math.floor(Math.random() * 9000 + 1000)}`;
  const fighter = room.addPlayer(conn, { ...profile, name });
  if (!loop) { loop = setInterval(tickAll, TICK * 1000); loop.unref?.(); }
  return { room, fighter };
}

export function leaveRoom(room, fighter) {
  room.removePlayer(fighter);
  if (!rooms.size && loop) { clearInterval(loop); loop = null; }
}

/** Handle one JSON message from a player (rate limited). */
export function handleMessage(room, fighter, text) {
  const now = Date.now();
  if (now - (fighter.msgWindow || 0) > 1000) { fighter.msgWindow = now; fighter.msgCount = 0; }
  if (++fighter.msgCount > MAX_MSGS_PER_SEC) return;
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  room.onMessage(fighter, m);
}

/** Players online per mode (for the menu). */
export function onlineCounts() {
  const out = {};
  for (const r of rooms.values()) out[r.mode] = (out[r.mode] || 0) + r.humans;
  return out;
}

/** Is this account already playing? (one connection per account) */
export function findUserFighter(userId) {
  for (const r of rooms.values()) for (const f of r.fighters.values()) if (f.user?.id === userId) return { room: r, fighter: f };
  return null;
}

/** Close every room (shutdown / tests). */
export function closeRooms() {
  for (const r of rooms.values()) for (const f of r.fighters.values()) if (f.human) f.conn.close(1001, 'server restarting');
  rooms.clear();
  if (loop) { clearInterval(loop); loop = null; }
}

/** The profile a player joins with: their account, or a guest with a checked name. */
export function profileFor(user, hello, validateUsername) {
  if (user) {
    const p = q.progress.get(user.id);
    let cosmetics = DEFAULT_COSMETICS;
    try { cosmetics = JSON.parse(user.cosmetics || 'null') || DEFAULT_COSMETICS; } catch { /* default */ }
    const owned = { skin: [], cape: [] };
    for (const row of q.owned.all(user.id)) if (owned[row.kind]) owned[row.kind].push(row.item_id);
    const ctx = { owned, staffRank: user.staff_rank, paidRank: user.paid_rank, bestStreak: p.bestStreak, created: user.created };
    return {
      user: { id: user.id }, name: user.name, rank: displayRank(user.staff_rank, user.paid_rank).id,
      xp: p.xp, level: levelFromXp(p.xp).level, cosmetics: sanitizeCosmetics(cosmetics, ctx),
    };
  }
  // guests: a valid name that doesn't impersonate an account
  let name = typeof hello.name === 'string' ? hello.name.trim().replace(/\s+/g, '_').slice(0, 16) : '';
  if (validateUsername(name)) name = 'Guest';
  if (q.userByName.get(name) || name === 'Guest') name = `${name.slice(0, 11)}${Math.floor(Math.random() * 90000 + 10000)}`;
  const guestCtx = { owned: { skin: [], cape: [] }, staffRank: null, paidRank: null, bestStreak: 0, created: 0 };
  return { user: null, name, rank: 'NONE', xp: 0, level: 1, cosmetics: sanitizeCosmetics(hello.cos, guestCtx) };
}
