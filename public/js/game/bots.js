// Bot AI (runs per tick): pick targets, chase, strafe, click-spam with W-taps, crit-jump,
// block, rod at mid range and bow at long range. What they carry depends on the mode: in Pot PvP
// they throw healing potions at their feet, in Combo they drink flasks, and in Sumo they fight
// with their fists and try to stay on the ring. Rendering/animation runs per frame.
import * as THREE from '../vendor/three.js';
import { angDiff, clamp, pick, rand } from '../core/util.js';
import { game } from '../core/state.js';
import { lineOfSight, map, CX, CZ } from '../world/world.js';
import { physicsTick, inSafeZone, horizontalSpeed, USE_ITEM_SLOW, TICK } from './physics.js';
import { damage, kill, tickVitals, REACH, CRIT_MULTIPLIER } from './combat.js';
import { shootArrow, castHook, reelHook, throwItem } from './projectiles.js';
import { rules } from './rules.js';
import { burst } from './effects.js';
import { animateCape, showHeld } from './characters.js';
import { bots, fighters, player, randomSpawn, spawnBot } from './entities.js';

const SIGHT_RANGE = 30;
const BOW_MIN = 10, BOW_MAX = 28, ARROW_SPEED = 3;
const ROD_MIN = 3.5, ROD_MAX = 8;
const DRINK_TIME = 1.6;
const NET_INTERVAL_MS = 50; // server snapshots arrive 20 times a second
// Difficulty: tuned so a new player on a laptop trackpad wins most fights, but bots still fight back.
const TURN_RATE = 3.5; // how fast bots turn to face you (slow, so strafing around them works)
const CPS = [2.5, 4.5]; // bot clicks per second
const HIT_CHANCE = 0.55; // x skill: chance each click lands
const FACING = 0.55; // radians: a bot only lands hits when roughly facing its target
const REACTION = [0.35, 0.7]; // seconds before a bot swings at a new target
const MAX_ON_PLAYER = 2; // bots avoid piling onto the player beyond this
const eyeA = new THREE.Vector3(), eyeB = new THREE.Vector3(), _fx = new THREE.Vector3();

function turnToward(b, dx, dz, rate) {
  b.yaw += angDiff(Math.atan2(-dx, -dz), b.yaw) * Math.min(1, TICK * rate);
}

function chooseTarget(b) {
  let best = null, bestScore = SIGHT_RANGE;
  for (const f of fighters) {
    if (f === b || !f.alive || inSafeZone(f) || f.protectT > 0) continue;
    if (map.ring && f.pos.y < map.ringY - 1) continue; // already falling off
    let score = f.pos.distanceTo(b.pos);
    if (f === b.target) score -= 4; // stick with the current fight
    if (f === b.lastAttacker && game.time - b.lastHitT < 5) score -= 8; // retaliate
    if (f === player && f !== b.target && bots.filter((o) => o.target === player).length >= MAX_ON_PLAYER) score += 12; // don't gang up
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

function think(b) {
  b.thinkT = rand(0.25, 0.6);
  b.strafe = pick([-1, -1, 0, 1, 1]);
  const prev = b.target;
  b.target = chooseTarget(b);
  if (b.target && b.target !== prev) b.attackCd = Math.max(b.attackCd, rand(...REACTION));
  b.sprintHits = Math.random() < b.skill; // only sometimes go for sprint hits
  if (!b.target && (!b.wanderTo || b.pos.distanceTo(b.wanderTo) < 2)) b.wanderTo = randomSpawn();
  const t = b.target;
  if (t && rules().bot.block && b.held === 'sword' && game.time - t.lastSwingT < 0.3 && t.pos.distanceTo(b.pos) < 3.5 && Math.random() < 0.12 * b.skill) {
    b.blockT = rand(0.2, 0.45);
  }
}

function stopRod(b) {
  if (b.hook) reelHook(b.hook);
  b.hook = null;
  if (b.held === 'rod') b.held = rules().bot.weapon;
}

/** Pot PvP: throw a healing potion straight down at your own feet, then back off for a moment. */
function tryPot(b) {
  if (!(b.inv.pots > 0) || b.potCd > 0 || b.hp > 6 + b.skill * 3) return false;
  eyeA.set(b.pos.x, b.pos.y + 1.62, b.pos.z);
  // sloppy throws: often lands a little away from their feet and heals less
  throwItem(b, 'splash', eyeA.clone(), new THREE.Vector3(b.vel.x + rand(-0.12, 0.12), -0.5, b.vel.z + rand(-0.12, 0.12)));
  b.inv.pots--;
  b.potCd = rand(1.5, 2.8);
  b.held = 'splash';
  b.heldT = 0.35;
  b.retreatT = rand(0.3, 0.7);
  b.swing = 1;
  return true;
}

/** Combo: drink a golden flask when low (regeneration + absorption). */
function tickDrink(b) {
  b.drinkT -= TICK;
  if (b.drinkT > 0) return true;
  b.drinkT = 0;
  b.regenT = 5;
  b.regenAcc = 0;
  b.absorb = 4;
  b.held = rules().bot.weapon;
  burst(_fx.set(b.pos.x, b.pos.y + 1, b.pos.z), [0xffd36b, 0xff6f8e], 10, 2);
  return false;
}

/** Sumo: steer back toward the middle when close to the edge. */
function keepOnRing(b, mv) {
  const cx = CX - b.pos.x, cz = CZ - b.pos.z, cd = Math.hypot(cx, cz);
  if (cd < map.ring - 3.2 || cd < 1e-3) return;
  const nx = cx / cd, nz = cz / cd;
  const toCenterF = nx * -Math.sin(b.yaw) + nz * -Math.cos(b.yaw), toCenterR = nx * Math.cos(b.yaw) + nz * -Math.sin(b.yaw);
  const urgency = clamp((cd - (map.ring - 3.2)) / 2, 0, 1) * (0.6 + b.skill * 0.6);
  mv.forward = clamp(mv.forward + toCenterF * urgency * 1.5, -1, 1);
  mv.strafe = clamp(mv.strafe + toCenterR * urgency * 1.5, -1, 1);
  if (mv.forward <= 0) mv.sprint = false;
}

/** Returns movement input { forward, strafe, sprint, jump, slow }. */
function fight(b, t) {
  const kit = rules().bot;
  const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, dist = Math.hypot(dx, dz);
  turnToward(b, dx, dz, TURN_RATE + b.skill * 2);
  eyeA.set(b.pos.x, b.pos.y + 1.62, b.pos.z);
  eyeB.set(t.pos.x, t.pos.y + 1.4, t.pos.z);
  b.pitch = Math.atan2(eyeB.y - eyeA.y, dist) * 0.8;

  // healing first
  if (b.drinkT > 0 && tickDrink(b)) return { forward: -0.4, strafe: b.strafe, slow: USE_ITEM_SLOW };
  if (kit.flasks && b.inv.flasks > 0 && b.hp <= 8 && b.absorb <= 0 && b.potCd <= 0) {
    b.inv.flasks--; b.drinkT = DRINK_TIME; b.potCd = 3; b.held = 'flask';
    return { forward: -0.4, strafe: b.strafe, slow: USE_ITEM_SLOW };
  }
  if (kit.pots) tryPot(b);
  if (b.retreatT > 0) {
    b.pitch = -1.2;
    return { forward: -1, strafe: b.strafe };
  }

  // drawing the bow: slow strafe, release when fully drawn
  if (b.drawing > 0) {
    b.drawing += TICK;
    if (dist < 6) { b.drawing = 0; b.held = kit.weapon; }
    else if (b.drawing >= b.drawGoal) {
      const ticks = Math.hypot(dist, eyeB.y - eyeA.y) / ARROW_SPEED, spread = 0.12 + (1 - b.skill) * 0.3;
      const aim = new THREE.Vector3(
        (dx + t.vel.x * ticks) / ticks + rand(-spread, spread),
        (eyeB.y - eyeA.y) / ticks + 0.5 * 0.05 * ticks + rand(-spread, spread) * 0.5,
        (dz + t.vel.z * ticks) / ticks + rand(-spread, spread),
      );
      shootArrow(b, eyeA.clone(), aim.clampLength(0, ARROW_SPEED), { crit: true });
      b.drawing = 0; b.held = kit.weapon; b.bowCd = rand(7, 13);
    }
    return { forward: 0, strafe: b.strafe, slow: USE_ITEM_SLOW };
  }
  if (kit.bow && dist > BOW_MIN && dist < BOW_MAX && b.bowCd <= 0 && !b.hook && lineOfSight(eyeA, eyeB)) {
    b.held = 'bow'; b.drawing = 1e-3; b.drawGoal = rand(0.9, 1.2);
    return { forward: 0, strafe: 0 };
  }

  // fishing rod: cast at mid range, reel in once close
  if (b.hook) {
    b.hookT += TICK;
    if (dist < 3 || b.hookT > 1.2) stopRod(b);
  } else if (kit.rod && dist > ROD_MIN && dist < ROD_MAX && b.rodCd <= 0 && lineOfSight(eyeA, eyeB) && Math.random() < b.skill * 0.6) {
    const dir = eyeB.clone().sub(eyeA).add(_fx.set(t.vel.x * 6, dist * 0.09, t.vel.z * 6));
    b.hook = castHook(b, eyeA.clone(), dir);
    b.hookT = 0;
    b.held = 'rod';
    b.rodCd = rand(6, 11);
  }

  // melee
  const blocking = kit.block && b.blockT > 0 && b.held === 'sword';
  const forward = dist > 2.4 ? 1 : dist < 1.5 ? -0.5 : 0.25, strafe = dist < 5 ? b.strafe * 0.8 : 0;
  b.sprinting = forward > 0 && b.wtapT <= 0 && !blocking && (b.sprintHits || dist > 4);
  if (!blocking && b.held !== 'rod' && dist < REACH && Math.abs(t.pos.y - b.pos.y) < 2.5 && b.attackCd <= 0) {
    b.attackCd = 1 / rand(...CPS);
    b.swing = 1;
    b.lastSwingT = game.time;
    const facing = Math.abs(angDiff(Math.atan2(-dx, -dz), b.yaw)) < FACING;
    if (facing && Math.random() < b.skill * HIT_CHANCE && lineOfSight(eyeA, eyeB)) {
      const crit = b.fallDistance > 0 && !b.onGround;
      if (damage(t, rules().botDamage * (crit ? CRIT_MULTIPLIER : 1), b, 'melee', { sprint: b.sprinting })) {
        b.wtapT = rand(0.3, 0.7);
        if (crit) burst(_fx.set(t.pos.x, t.pos.y + 1.5, t.pos.z), 0xffd84a, 8, 3.5, 0.8);
      }
    }
  }
  const jump = !kit.sumo && dist < 3.6 && b.onGround && !blocking && Math.random() < b.skill * TICK * 0.5; // crit jumps
  const mv = { forward, strafe, sprint: b.sprinting, jump, slow: blocking ? USE_ITEM_SLOW : 1 };
  if (kit.sumo) keepOnRing(b, mv);
  return mv;
}

function wander(b) {
  stopRod(b);
  if (b.drinkT > 0) tickDrink(b);
  else if (b.heldT <= 0) b.held = rules().bot.weapon;
  b.drawing = 0;
  b.pitch *= 0.9;
  if (!b.wanderTo) return { forward: 0, strafe: 0 };
  const dx = b.wanderTo.x - b.pos.x, dz = b.wanderTo.z - b.pos.z;
  if (Math.hypot(dx, dz) <= 1) return { forward: 0, strafe: 0 };
  turnToward(b, dx, dz, 5);
  return { forward: 0.75, strafe: 0 };
}

function tickBot(b) {
  b.snapshot();
  if (!b.alive) { stopRod(b); b.respawnT -= TICK; if (b.respawnT <= 0) spawnBot(b); return; }
  for (const k of ['attackCd', 'bowCd', 'rodCd', 'thinkT', 'wtapT', 'blockT', 'potCd', 'retreatT']) b[k] = (b[k] || 0) - TICK;
  if (b.heldT > 0 && (b.heldT -= TICK) <= 0 && b.held === 'splash') b.held = rules().bot.weapon;
  tickVitals(b, TICK);
  if (!b.alive) return;
  if (b.thinkT <= 0) think(b);
  b.sprinting = false;
  const t = b.target;
  const input = t && t.alive && !inSafeZone(t) && !(t.protectT > 0) ? fight(b, t) : wander(b);
  if (!t && rules().bot.sumo) keepOnRing(b, input);
  b.blocking = rules().bot.block && b.blockT > 0 && b.held === 'sword';

  if (b.hitWall && b.onGround) { input.jump = true; b.stuckT += TICK; } else b.stuckT = Math.max(0, b.stuckT - TICK);
  if (b.stuckT > 1.2) { b.stuckT = 0; b.wanderTo = randomSpawn(); b.target = null; b.thinkT = 1.5; }

  physicsTick(b, input.forward, input.strafe, input);
  if (b.pos.y < map.killY) { b.hp = 0; kill(b, null, 'void'); }
}

/** Soft push so fighters don't stand inside each other. */
function separate() {
  for (let i = 0; i < fighters.length; i++) {
    for (let j = i + 1; j < fighters.length; j++) {
      const a = fighters[i], b = fighters[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1.6) {
        const p = ((0.6 - d) * 0.05) / d;
        a.vel.x -= dx * p; a.vel.z -= dz * p;
        b.vel.x += dx * p; b.vel.z += dz * p;
      }
    }
  }
}

export function tickBots() {
  for (const b of bots) if (!b.remote) tickBot(b); // remote fighters are moved by the server
  separate();
}

/** Per-frame: interpolate positions between ticks and animate limbs, capes and hurt flashes. */
export function renderBots(alpha, dt) {
  const now = performance.now();
  for (const b of bots) {
    if (!b.alive) continue;
    const m = b.model, hs = horizontalSpeed(b);
    // remote fighters move between network updates (~50 ms apart) instead of game ticks
    const a = b.remote ? Math.min(1, (now - b.netAt) / NET_INTERVAL_MS) : alpha;
    if (b.remote) b.hurtT -= dt;
    m.group.position.lerpVectors(b.prevPos, b.pos, a);
    m.group.rotation.y = b.prevYaw + angDiff(b.yaw, b.prevYaw) * a;
    showHeld(m, b.held);
    b.walkPhase += hs * dt * 2.4;
    const sw = Math.sin(b.walkPhase) * Math.min(1, hs / 4) * 0.9;
    m.legL.rotation.x = sw;
    m.legR.rotation.x = -sw;
    b.swing = Math.max(0, b.swing - dt * 5);
    if (b.drawing > 0) {
      m.armR.rotation.set(-Math.PI / 2 + b.pitch, -0.1, 0);
      m.armL.rotation.set(-Math.PI / 2 + b.pitch, 0.5, 0);
    } else if (b.blocking) {
      m.armR.rotation.set(-0.9, -0.5, 0.3);
      m.armL.rotation.set(-sw * 0.8, 0, 0);
    } else {
      const s = Math.sin(b.swing * Math.PI);
      m.armR.rotation.set(sw * 0.6 - s * 1.7 - 0.15 - (b.held === 'rod' ? 0.6 : 0), 0, s * 0.4);
      m.armL.rotation.set(-sw * 0.8, 0, 0);
    }
    m.head.rotation.x = b.pitch;
    animateCape(m, hs, b.vel.y, dt, b.walkPhase);
    const red = b.hurtT > 0 ? 0x881111 : 0;
    for (const mt of m.mats) mt.emissive.setHex(red);
  }
}
