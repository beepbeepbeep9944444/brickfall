// Server-side bots that keep online rooms busy until enough real players join. Same difficulty as
// the offline bots (easy enough for a trackpad): slow turning, a few clicks per second, sloppy aim.
// They fight with melee only, pot or drink when low, and stay on the ring in Sumo.
import { RANKS, SKINS, CAPES } from '../../public/js/shared/cosmetics.js';
import { physicsTick, inSafeZone, TICK } from '../../public/js/game/physics.js';
import { lineOfSight, map, CX, CZ } from '../../public/js/world/world.js';

const SIGHT = 30, REACH = 3;
const TURN_RATE = 3.5, CPS = [2.5, 4.5], HIT_CHANCE = 0.55, FACING = 0.55, REACTION = [0.35, 0.7];
const MAX_ON_ONE_PLAYER = 2;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const ADJ = ['Swift', 'Rusty', 'Mighty', 'Sneaky', 'Lucky', 'Grumpy', 'Turbo', 'Cosmic', 'Brave', 'Sly', 'Jolly', 'Fuzzy', 'Salty', 'Spicy'];
const ANIMALS = ['Otter', 'Falcon', 'Badger', 'Llama', 'Panda', 'Gecko', 'Moose', 'Raven', 'Yak', 'Lynx', 'Koala', 'Wombat', 'Ferret', 'Newt'];
const RANK_WEIGHTS = { NONE: 55, ACE: 22, HERO: 15, TITAN: 8 };

export function botName(taken) {
  let n;
  do n = pick(ADJ) + pick(ANIMALS) + Math.floor(rand(1, 100)); while (taken(n));
  return n;
}

/** Rank, level and cosmetics for a new bot (anything a player of that rank could own). */
export function botLooks() {
  let r = Math.random() * 100, rank = RANKS[0];
  for (const [id, w] of Object.entries(RANK_WEIGHTS)) { r -= w; if (r <= 0) { rank = RANKS.find((x) => x.id === id); break; } }
  const allowed = (item) => !item.unlock && (!item.rank || RANKS.find((x) => x.id === item.rank).tier <= rank.tier);
  const capes = CAPES.filter((c) => c.id !== 'none' && allowed(c));
  return {
    rank: rank.id,
    level: Math.max(1, Math.floor(Math.pow(Math.random(), 1.6) * 70)),
    cosmetics: { skin: pick(SKINS.filter(allowed)).id, cape: Math.random() < 0.25 + rank.tier * 0.2 ? pick(capes).id : 'none' },
  };
}

export function initBotBrain(b) {
  Object.assign(b, { skill: rand(0.3, 0.6), target: null, thinkT: 0, strafeDir: 0, wanderTo: null, attackCd: 0, wtapT: 0, potCd: 0, drinkT: 0, retreatT: 0, sprintHits: false });
}

function chooseTarget(room, b) {
  let best = null, bestScore = SIGHT;
  for (const f of room.fighters.values()) {
    if (f === b || !f.alive || f.protectT > 0 || inSafeZone(f)) continue;
    if (map.ring && f.pos.y < map.ringY - 1) continue;
    let score = Math.hypot(f.pos.x - b.pos.x, f.pos.y - b.pos.y, f.pos.z - b.pos.z);
    if (f === b.target) score -= 4;
    if (f === b.lastAttacker && room.time - b.lastHitT < 5) score -= 8;
    if (f.human && f !== b.target) {
      let on = 0;
      for (const o of room.fighters.values()) if (o.bot && o.target === f) on++;
      if (on >= MAX_ON_ONE_PLAYER) score += 12;
    }
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function keepOnRing(b, mv) {
  const cx = CX - b.pos.x, cz = CZ - b.pos.z, cd = Math.hypot(cx, cz);
  if (!map.ring || cd < map.ring - 3.2 || cd < 1e-3) return;
  const nx = cx / cd, nz = cz / cd;
  const f = nx * -Math.sin(b.yaw) + nz * -Math.cos(b.yaw), s = nx * Math.cos(b.yaw) + nz * -Math.sin(b.yaw);
  const urgency = clamp((cd - (map.ring - 3.2)) / 2, 0, 1) * (0.6 + b.skill * 0.6);
  mv.forward = clamp(mv.forward + f * urgency * 1.5, -1, 1);
  mv.strafe = clamp(mv.strafe + s * urgency * 1.5, -1, 1);
  if (mv.forward <= 0) mv.sprint = false;
}

/**
 * One tick of AI + physics for a bot. `room` supplies the rules, `hit(attacker, victim, opts)`
 * applies a melee hit through the room's combat code, `heal(f, amount)` heals.
 */
export function tickBot(room, b, { hit, heal, respawn }) {
  const R = room.rules, kit = R.bot;
  if (!b.alive) {
    b.respawnT -= TICK;
    if (b.respawnT <= 0) respawn(b);
    return;
  }
  for (const k of ['attackCd', 'thinkT', 'wtapT', 'potCd', 'retreatT']) b[k] -= TICK;

  if (b.thinkT <= 0) {
    b.thinkT = rand(0.25, 0.6);
    b.strafeDir = pick([-1, -1, 0, 1, 1]);
    const prev = b.target;
    b.target = chooseTarget(room, b);
    if (b.target && b.target !== prev) b.attackCd = Math.max(b.attackCd, rand(...REACTION));
    b.sprintHits = Math.random() < b.skill;
    if (!b.target && (!b.wanderTo || Math.hypot(b.wanderTo.x - b.pos.x, b.wanderTo.z - b.pos.z) < 2)) b.wanderTo = room.spawnPoint();
  }

  let mv = { forward: 0, strafe: 0, sprint: false, jump: false, slow: 1 };
  const t = b.target;
  b.sprinting = false;
  if (b.drinkT > 0) {
    b.drinkT -= TICK;
    mv = { forward: -0.4, strafe: b.strafeDir, slow: 0.2 };
    if (b.drinkT <= 0) { b.regenT = 5; b.regenAcc = 0; b.absorb = 4; b.held = kit.weapon; }
  } else if (t && t.alive && !inSafeZone(t) && !(t.protectT > 0)) {
    const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, dist = Math.hypot(dx, dz);
    b.yaw += angDiff(Math.atan2(-dx, -dz), b.yaw) * Math.min(1, TICK * (TURN_RATE + b.skill * 2));
    b.pitch = Math.atan2(t.pos.y - b.pos.y, dist) * 0.8;

    // healing when low
    if (kit.pots && b.inv.pots > 0 && b.potCd <= 0 && b.hp <= 6 + b.skill * 3) {
      b.inv.pots--; b.potCd = rand(1.5, 2.8); b.retreatT = rand(0.3, 0.7);
      heal(b, Math.round(rand(5, 8)));
      room.broadcast({ t: 'fx', k: 'splash', p: [b.pos.x, b.pos.y + 0.2, b.pos.z] });
    }
    if (kit.flasks && b.inv.flasks > 0 && b.hp <= 8 && b.absorb <= 0 && b.potCd <= 0) {
      b.inv.flasks--; b.drinkT = 1.6; b.potCd = 3; b.held = 'flask';
    }

    if (b.retreatT > 0) {
      mv = { forward: -1, strafe: b.strafeDir };
    } else {
      const forward = dist > 2.4 ? 1 : dist < 1.5 ? -0.5 : 0.25;
      b.sprinting = forward > 0 && b.wtapT <= 0 && (b.sprintHits || dist > 4);
      if (dist < REACH && Math.abs(t.pos.y - b.pos.y) < 2.5 && b.attackCd <= 0) {
        b.attackCd = 1 / rand(...CPS);
        b.swingT = room.time;
        const facing = Math.abs(angDiff(Math.atan2(-dx, -dz), b.yaw)) < FACING;
        const eyeA = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z }, eyeB = { x: t.pos.x, y: t.pos.y + 1.4, z: t.pos.z };
        if (facing && Math.random() < b.skill * HIT_CHANCE && lineOfSight(eyeA, eyeB)) {
          const crit = b.fallDistance > 0 && !b.onGround;
          if (hit(b, t, { kind: 'melee', crit, sprint: b.sprinting })) b.wtapT = rand(0.3, 0.7);
        }
      }
      const jump = !kit.sumo && dist < 3.6 && b.onGround && Math.random() < b.skill * TICK * 0.5;
      mv = { forward, strafe: dist < 5 ? b.strafeDir * 0.8 : 0, sprint: b.sprinting, jump };
    }
  } else if (b.wanderTo) {
    b.pitch *= 0.9;
    const dx = b.wanderTo.x - b.pos.x, dz = b.wanderTo.z - b.pos.z;
    if (Math.hypot(dx, dz) > 1) {
      b.yaw += angDiff(Math.atan2(-dx, -dz), b.yaw) * Math.min(1, TICK * 5);
      mv.forward = 0.75;
    }
  }
  if (kit.sumo) keepOnRing(b, mv);
  if (b.hitWall && b.onGround) mv.jump = true;
  physicsTick(b, mv.forward, mv.strafe, mv);
}
