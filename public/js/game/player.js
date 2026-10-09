// Local player controller (runs per tick): movement, items, attacking and building.
// The hotbar comes from the active mode's kit (game/rules.js).
import * as THREE from '../vendor/three.js';
import { rand } from '../core/util.js';
import { game, input } from '../core/state.js';
import { settings } from '../core/settings.js';
import { events } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { itemAt } from '../render/icons.js';
import { B, BLOCK_COLOR } from '../render/textures.js';
import { W, H, D, CX, CZ, SPAWN_TOP, map, getB, raycastVoxel, rayAABB } from '../world/world.js';
import { isPlaced, placeBlock, removeBlock } from '../world/placed.js';
import { physicsTick, aabbOf, USE_ITEM_SLOW, TICK } from './physics.js';
import { damage, kill, tickVitals, REACH, CRIT_MULTIPLIER } from './combat.js';
import { shootArrow, castHook, reelHook, throwItem } from './projectiles.js';
import { rules } from './rules.js';
import { net } from '../net/net.js';
import { burst } from './effects.js';
import { player, bots, fighters, spawnAwayFrom } from './entities.js';

const BUILD_REACH = 5;
const DRINK_TIME = 1.6; // 32 ticks
const FLASK_REGEN_TIME = 5; // Regeneration II
const FLASK_ABSORPTION = 4; // two bonus hearts
const ARROW_MAX_SPEED = 3; // blocks per tick at full draw
const SPEED_TIME = 90, SPEED_LEVEL = 2; // Swiftness II for 1:30
const SPLASH_SPEED = 0.5, SPLASH_LIFT = 20 * Math.PI / 180; // thrown 20 degrees above the crosshair
const PEARL_SPEED = 1.5;

const _dir = new THREE.Vector3(), _fx = new THREE.Vector3();

export function camDir(out) {
  const cp = Math.cos(player.pitch);
  return out.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
}

export function respawnPlayer() {
  const a = rand(0, Math.PI * 2), R = rules();
  if (player.hook) reelHook(player.hook);
  Object.assign(player, {
    hp: player.maxHp, absorb: 0, regenT: 0, speedT: 0, alive: true, iframe: 0, foodRegenT: 0, fallDistance: 0, landedFrom: 0,
    yaw: a + Math.PI / 2, pitch: -0.2, inv: { ...R.inventory }, charge: 0, bowT: 0, drink: 0,
    sprintBroken: false, hurtAnim: 0, hook: null, protectT: R.protect || 0,
  });
  if (map.tower) player.pos.set(CX + Math.cos(a) * 2, SPAWN_TOP, CZ + Math.sin(a) * 2);
  else {
    const p = player.pos.copy(spawnAwayFrom(player));
    player.yaw = Math.atan2(-(CX - p.x), -(CZ - p.z)); // face the middle
  }
  player.prevPos.copy(player.pos);
  player.prevYaw = player.yaw;
  player.vel.set(0, 0, 0);
  input.sprintToggled = false;
  input.dtSprint = false;
  selectSlot(0, true);
  events.emit('respawn');
}

export function selectSlot(i, force = false) {
  if (player.slot === i && !force) return;
  if (player.hook) reelHook(player.hook); // the line snaps when you stop holding the rod
  player.slot = i;
  player.charge = 0;
  player.bowT = 0;
  player.drink = 0;
  events.emit('slot', { index: i });
}

function meleeTarget(reach) {
  const o = player.eye.clone(), d = camDir(_dir);
  const wall = raycastVoxel(o, d, reach);
  let best = null, bestT = wall ? wall.t : reach;
  for (const b of bots) {
    if (!b.alive) continue;
    const { mn, mx } = aabbOf(b, 0.25); // generous melee hitboxes (forgiving on trackpads)
    const t = rayAABB(o, d, mn, mx);
    if (t < bestT) { bestT = t; best = b; }
  }
  return best;
}

function attack() {
  const R = rules(), isSword = itemAt(player.slot) === 'sword';
  player.lastSwingT = game.time;
  events.emit('swing');
  const t = meleeTarget(REACH);
  if (!t) { sfx('swing'); return; }
  const crit = player.fallDistance > 0 && !player.onGround;
  const dmg = (isSword ? R.swordDamage : R.fistDamage) * (crit ? CRIT_MULTIPLIER : 1);
  if (damage(t, dmg, player, 'melee', { sprint: player.sprinting, crit })) {
    sfx(crit ? 'crit' : 'hit');
    if (crit) burst(_fx.set(t.pos.x, t.pos.y + 1.5, t.pos.z), 0xffd84a, 10, 3.5, 0.8);
  }
}

function tryBreak(pressed) {
  if (player.useCd > 0) return;
  const h = raycastVoxel(player.eye.clone(), camDir(_dir), BUILD_REACH);
  if (!h || !isPlaced(h.x, h.y, h.z)) { if (pressed) attack(); return; }
  const type = removeBlock(h.x, h.y, h.z);
  if (net.online) net.send({ t: 'break', x: h.x, y: h.y, z: h.z });
  burst(_fx.set(h.x + 0.5, h.y + 0.5, h.z + 0.5), BLOCK_COLOR[type], 10, 3, 1);
  sfx('break');
  events.emit('swing');
  player.inv.blocks = Math.min(64, player.inv.blocks + 1);
  player.useCd = 0.15;
}

function tryPlace() {
  if (player.useCd > 0 || player.inv.blocks <= 0) return;
  const h = raycastVoxel(player.eye.clone(), camDir(_dir), BUILD_REACH);
  if (!h) return;
  const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
  if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1 || y < 1 || y >= H - 1 || getB(x, y, z)) return;
  if (y >= SPAWN_TOP - 2 && Math.hypot(x + 0.5 - CX, z + 0.5 - CZ) < 7.5) return; // keep the spawn clear
  for (const f of fighters) {
    if (!f.alive) continue;
    const { mn, mx } = aabbOf(f);
    if (x + 1 > mn.x && x < mx.x && y + 1 > mn.y && y < mx.y && z + 1 > mn.z && z < mx.z) return;
  }
  placeBlock(x, y, z, B.PLANKS);
  if (net.online) net.send({ t: 'place', x, y, z });
  player.inv.blocks--;
  player.useCd = 0.2;
  sfx('place');
  events.emit('swing');
}

function useBow() {
  const P = player;
  if (input.rmb && input.locked && P.inv.arrows > 0) {
    P.bowT += TICK;
    const t = Math.min(1, P.bowT);
    P.charge = Math.min(1, (t * t + 2 * t) / 3);
  } else if (P.bowT > 0) {
    if (P.charge >= 0.1 && P.inv.arrows > 0) {
      const d = camDir(_dir), origin = P.eye.clone().addScaledVector(d, 0.3);
      shootArrow(P, origin, d.clone().multiplyScalar(P.charge * ARROW_MAX_SPEED), { crit: P.charge >= 1 });
      P.inv.arrows--;
      sfx('bow');
    }
    P.bowT = 0;
    P.charge = 0;
  }
}

function useRod() {
  const P = player;
  if (!input.rmbEdge || P.useCd > 0) return;
  P.useCd = 0.15;
  events.emit('swing');
  if (P.hook) { reelHook(P.hook); return; }
  const d = camDir(_dir);
  P.hook = castHook(P, P.eye.clone().addScaledVector(d, 0.3), d.clone());
}

/** Hold right-click to drink: the golden flask (regen + absorption) or a swiftness potion. */
function useDrink(item) {
  const P = player, key = item === 'flask' ? 'flasks' : 'speed';
  if (input.rmb && input.locked && P.inv[key] > 0 && P.useCd <= 0) {
    P.drink += TICK / DRINK_TIME;
    if (P.drink >= 1) {
      if (item === 'flask') {
        P.regenT = FLASK_REGEN_TIME;
        P.regenAcc = 0;
        P.absorb = FLASK_ABSORPTION;
      } else {
        P.speedT = SPEED_TIME;
        P.speedLevel = SPEED_LEVEL;
      }
      P.inv[key]--;
      P.drink = 0;
      P.useCd = 0.4;
      if (net.online) net.send({ t: 'drink', k: item });
      sfx('drink');
      burst(_fx.set(P.pos.x, P.pos.y + 1, P.pos.z), item === 'flask' ? [0xffd36b, 0xff6f8e] : [0x4cc9f0, 0xa8ecff], 12, 2);
    }
  } else {
    P.drink = 0;
  }
}

/** Right-click throws: splash potions arc up 20 degrees; pearls fly straight and fast. */
function useThrow(item) {
  const P = player, key = item === 'splash' ? 'pots' : 'pearls';
  if (!input.rmbEdge || P.useCd > 0 || !(P.inv[key] > 0)) return;
  const d = camDir(_dir);
  if (item === 'splash') {
    const pitch = Math.min(Math.PI / 2, P.pitch + SPLASH_LIFT), cp = Math.cos(pitch);
    d.set(-Math.sin(P.yaw) * cp, Math.sin(pitch), -Math.cos(P.yaw) * cp).multiplyScalar(SPLASH_SPEED);
    P.useCd = 0.2;
  } else {
    d.multiplyScalar(PEARL_SPEED);
    P.useCd = 0.5;
  }
  throwItem(P, item, P.eye.clone(), d);
  P.inv[key]--;
  sfx('swing');
  events.emit('swing');
}

export function tickPlayer() {
  const P = player;
  P.snapshot();
  if (!P.alive) return;
  P.useCd -= TICK;
  tickVitals(P, TICK);
  if (!P.alive) return;

  const { keys } = input;
  const item = itemAt(P.slot);
  P.blocking = item === 'sword' && input.rmb && input.locked && game.time - P.lastSwingT > 0.1;
  const usingItem = P.blocking || P.bowT > 0 || P.drink > 0;

  // movement input (no movement while the pointer isn't captured)
  const forward = input.locked ? (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) : 0;
  const strafe = input.locked ? (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) : 0;

  // sprinting: holding the sprint key re-sprints the next tick after a sprint hit;
  // double-tap sprint does not, so double-tappers have to W-tap to sprint-hit again
  if (P.sprintBroken) { input.dtSprint = false; P.sprintBroken = false; }
  if (!keys.KeyW) input.dtSprint = false;
  const sprintKey = input.touchSprint || (settings.toggleSprint ? input.sprintToggled : !!(keys.ControlLeft || keys.ShiftLeft || keys.ShiftRight));
  P.sprinting = forward > 0 && !usingItem && !P.hitWall && (sprintKey || input.dtSprint);

  physicsTick(P, forward, strafe, { sprint: P.sprinting, jump: input.locked && !!keys.Space, slow: usingItem ? USE_ITEM_SLOW : 1 });
  if (P.pos.y < map.killY) { P.hp = 0; kill(P, null, 'void'); return; }

  // items
  if (item === 'bow') useBow();
  else if (item === 'rod') useRod();
  else if (item === 'flask' || item === 'speed') useDrink(item);
  else if (item === 'splash' || item === 'pearl') useThrow(item);
  else if (item === 'blocks' && input.rmb) tryPlace();

  // every click this tick is an attack (classic combat has no cooldown)
  for (; input.clicks > 0; input.clicks--) {
    if (item === 'blocks') tryBreak(true);
    else { P.drink = 0; attack(); }
  }
  if (item === 'blocks' && input.lmb) tryBreak(false);
  input.rmbEdge = false;
}
