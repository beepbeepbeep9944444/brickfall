// Entity movement, modelled on the classic (1.8.9) block-game physics.
// Runs at a fixed 20 ticks per second; velocities are in blocks per tick.
//
// Per tick:  jump -> accelerate from input -> move & collide -> gravity + drag -> friction
//   ground friction 0.546 (0.6 * 0.91), air 0.91, gravity 0.08, vertical drag 0.98,
//   walk acceleration 0.1 (x1.3 sprinting), air acceleration 0.02 (0.026 sprinting),
//   jump 0.42, sprint-jump boost 0.2 forward. Speed potions add 20% ground acceleration per level.
import { solid, map, SPAWN_TOP, CX, CZ } from '../world/world.js';

export const TPS = 20;
export const TICK = 1 / TPS;

export const GRAVITY = 0.08;
export const VERTICAL_DRAG = 0.98;
export const JUMP_VELOCITY = 0.42;
export const SPRINT_JUMP_BOOST = 0.2;
const GROUND_FRICTION = 0.6 * 0.91;
const AIR_FRICTION = 0.91;
const WALK_ACCEL = 0.1;
const SPRINT_MULTIPLIER = 1.3;
const AIR_ACCEL = 0.02;
const AIR_ACCEL_SPRINT = 0.026;
const INPUT_SCALE = 0.98;
const MIN_MOTION = 0.005;
/** Movement multiplier while blocking, drawing a bow or drinking. */
export const USE_ITEM_SLOW = 0.2;

/** Move along one axis and resolve collisions. Returns true if blocked. */
function moveAxis(e, axis, delta) {
  if (delta === 0) return false;
  const p = e.pos, hw = e.w / 2;
  p[axis] += delta;
  const x0 = Math.floor(p.x - hw), x1 = Math.floor(p.x + hw - 1e-7);
  const y0 = Math.floor(p.y), y1 = Math.floor(p.y + e.h - 1e-7);
  const z0 = Math.floor(p.z - hw), z1 = Math.floor(p.z + hw - 1e-7);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!solid(x, y, z)) continue;
        if (axis === 'y') {
          if (delta < 0) { p.y = y + 1; e.onGround = true; } else p.y = y - e.h - 1e-4;
        } else if (axis === 'x') {
          p.x = delta > 0 ? x - hw - 1e-4 : x + 1 + hw + 1e-4;
        } else {
          p.z = delta > 0 ? z - hw - 1e-4 : z + 1 + hw + 1e-4;
        }
        e.vel[axis] = 0;
        return true;
      }
    }
  }
  return false;
}

function move(e) {
  const v = e.vel;
  // sub-step large moves (fast falls, big knockback) so nothing tunnels through a block
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) / 0.4));
  const wasGround = e.onGround;
  e.onGround = false;
  e.hitWall = false;
  const startY = e.pos.y;
  for (let i = 0; i < steps; i++) {
    moveAxis(e, 'y', v.y / steps);
    if (moveAxis(e, 'x', v.x / steps)) e.hitWall = true;
    if (moveAxis(e, 'z', v.z / steps)) e.hitWall = true;
  }
  // fall distance (for crits and fall damage)
  const dy = e.pos.y - startY;
  if (e.onGround) {
    e.landedFrom = e.fallDistance;
    e.fallDistance = 0;
  } else {
    e.landedFrom = 0;
    if (wasGround) e.fallFromSafe = inSafeZone(e); // a fall that starts on the spawn tower never hurts
    if (dy < 0) e.fallDistance -= dy;
  }
}

/**
 * Advance one tick. `forward` / `strafe` are inputs in [-1, 1] relative to e.yaw
 * (forward = -Z when yaw = 0). Options: sprint, jump, slow (input multiplier).
 */
export function physicsTick(e, forward, strafe, { sprint = false, jump = false, slow = 1 } = {}) {
  const v = e.vel;
  if (Math.abs(v.x) < MIN_MOTION) v.x = 0;
  if (Math.abs(v.y) < MIN_MOTION) v.y = 0;
  if (Math.abs(v.z) < MIN_MOTION) v.z = 0;

  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  if (jump && e.onGround) {
    v.y = JUMP_VELOCITY;
    if (sprint) { v.x -= sy * SPRINT_JUMP_BOOST; v.z -= cy * SPRINT_JUMP_BOOST; }
  }

  const friction = e.onGround ? GROUND_FRICTION : AIR_FRICTION;
  const accel = e.onGround
    ? WALK_ACCEL * (sprint ? SPRINT_MULTIPLIER : 1) * (e.speedT > 0 ? 1 + 0.2 * e.speedLevel : 1) * (0.16277136 / (friction * friction * friction))
    : sprint ? AIR_ACCEL_SPRINT : AIR_ACCEL;
  const f = forward * INPUT_SCALE * slow, s = strafe * INPUT_SCALE * slow;
  let d = f * f + s * s;
  if (d >= 1e-4) {
    d = Math.sqrt(d);
    if (d < 1) d = 1;
    d = accel / d;
    v.x += -sy * f * d + cy * s * d;
    v.z += -cy * f * d - sy * s * d;
  }

  move(e);
  v.y = (v.y - GRAVITY) * VERTICAL_DRAG;
  v.x *= friction;
  v.z *= friction;
}

export function aabbOf(e, pad = 0) {
  return {
    mn: { x: e.pos.x - e.w / 2 - pad, y: e.pos.y - pad, z: e.pos.z - e.w / 2 - pad },
    mx: { x: e.pos.x + e.w / 2 + pad, y: e.pos.y + e.h + pad, z: e.pos.z + e.w / 2 + pad },
  };
}

/** On top of the spawn tower: nobody can deal or take damage there. */
export function inSafeZone(e) {
  return map.tower && e.pos.y >= SPAWN_TOP - 0.6 && Math.hypot(e.pos.x - CX, e.pos.z - CZ) < 5.8;
}

/** Horizontal speed in blocks per second (for animation). */
export const horizontalSpeed = (e) => Math.hypot(e.vel.x, e.vel.z) * TPS;
