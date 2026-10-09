// Arrows and fishing-rod bobbers, simulated per tick (velocities in blocks per tick).
//   arrows:  launch speed = draw * 3, gravity 0.05, drag 0.99; damage = ceil(impact speed * 2)
//            (+ up to half again on a fully drawn crit); knockback pushes away from the shooter
//   bobber:  launch speed 1.5, gravity 0.04, drag 0.92; a hit deals 0 damage but still knocks back
//            and starts the target's hurt-resistance (the classic "rod reset")
//   splash potion: launch speed 0.5 aimed 20 degrees above the crosshair, gravity 0.05, drag 0.99.
//            Heals everyone within 4 blocks of the impact by round(8 x (1 - distance / 4)); a direct hit heals 8
//   pearl:   launch speed 1.5, gravity 0.03, drag 0.99; teleports the thrower to where it lands (5 damage)
import * as THREE from '../vendor/three.js';
import { randi } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { scene } from '../render/scene.js';
import { raycastVoxel, rayAABB, solid, map } from '../world/world.js';
import { ITEM_GEO } from '../render/geometry.js';
import { itemMat } from '../render/materials.js';
import { burst } from './effects.js';
import { aabbOf } from './physics.js';
import { damage, heal } from './combat.js';
import { fighters, player } from './entities.js';
import { events } from '../core/events.js';
import { net } from '../net/net.js';

const ARROW_GRAVITY = 0.05, ARROW_DRAG = 0.99, ARROW_BASE_DAMAGE = 2;
const HOOK_SPEED = 1.5, HOOK_GRAVITY = 0.04, HOOK_DRAG = 0.92, HOOK_MAX_RANGE = 32;
const STUCK_LIFETIME = 6, MAX_ARROWS = 60;
const HIT_PADDING = 0.3; // projectiles test against hitboxes grown by 0.3

const arrowMats = {
  shaft: new THREE.MeshLambertMaterial({ color: 0x8a5a32 }),
  tip: new THREE.MeshLambertMaterial({ color: 0xc9ced8 }),
  fletch: new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
};
const shaftGeo = new THREE.BoxGeometry(0.04, 0.04, 0.7), tipGeo = new THREE.BoxGeometry(0.08, 0.08, 0.12), fletchGeo = new THREE.BoxGeometry(0.12, 0.02, 0.14);
const hookGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const hookMats = [0xf4f1ea, 0xf4f1ea, 0xff4d6d, 0xf4f1ea, 0xf4f1ea, 0xf4f1ea].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const lineMat = new THREE.LineBasicMaterial({ color: 0x20222e });

const SPLASH_RADIUS = 4, SPLASH_HEAL = 8, PEARL_DAMAGE = 5;
const THROWN = {
  splash: { gravity: 0.05, drag: 0.99, geo: ITEM_GEO.splash, scale: 0.4 },
  pearl: { gravity: 0.03, drag: 0.99, geo: ITEM_GEO.pearl, scale: 0.28 },
};

const arrows = [];
const hooks = new Set();
const thrown = [];
const _dir = new THREE.Vector3(), _look = new THREE.Vector3(), _tip = new THREE.Vector3();

function arrowMesh() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(shaftGeo, arrowMats.shaft));
  const tip = new THREE.Mesh(tipGeo, arrowMats.tip); tip.position.z = 0.38; g.add(tip);
  const fl = new THREE.Mesh(fletchGeo, arrowMats.fletch); fl.position.z = -0.3; g.add(fl);
  return g;
}

/** Trace one tick of movement; returns { t, fighter } for the first thing hit, or { t, block }. */
function sweep(p) {
  const len = p.vel.length();
  if (len < 1e-6) return null;
  _dir.copy(p.vel).divideScalar(len);
  const wall = raycastVoxel(p.pos, _dir, len);
  let best = wall ? { t: wall.t, block: true, nx: wall.nx, ny: wall.ny, nz: wall.nz } : null;
  for (const f of fighters) {
    if (!f.alive || f === p.owner) continue;
    const { mn, mx } = aabbOf(f, HIT_PADDING);
    const t = rayAABB(p.pos, _dir, mn, mx);
    if (t <= len && (!best || t < best.t)) best = { t, fighter: f };
  }
  return best;
}

// ---------------------------------------------------------------- arrows
/** `velocity` in blocks per tick. */
/** Our own shots are announced to other players; `visual` copies of theirs never hit anything. */
function announce(owner, kind, origin, velocity, crit = false) {
  if (owner === player && net.online) events.emit('localProjectile', { kind, p: origin, v: velocity, crit });
}

export function shootArrow(owner, origin, velocity, { crit = false, visual = false } = {}) {
  const g = arrowMesh();
  g.position.copy(origin);
  scene.add(g);
  arrows.push({ g, owner, crit, visual, pos: origin.clone(), prev: origin.clone(), vel: velocity.clone(), stuck: false, life: STUCK_LIFETIME, age: 0 });
  if (!visual) announce(owner, 'arrow', origin, velocity, crit);
  if (arrows.length > MAX_ARROWS) scene.remove(arrows.shift().g);
}

function tickArrow(a, dt) {
  a.prev.copy(a.pos);
  if (a.stuck) { a.life -= dt; return a.life > 0; }
  a.age++;
  const hit = sweep(a);
  if (hit?.fighter) {
    if (a.visual) return false;
    let dmg = Math.ceil(a.vel.length() * ARROW_BASE_DAMAGE);
    if (a.crit) dmg += randi(0, Math.floor(dmg / 2) + 1);
    damage(hit.fighter, dmg, a.owner, 'arrow', { knockFrom: a.owner.pos });
    return false;
  }
  if (hit?.block) {
    a.pos.addScaledVector(_dir.copy(a.vel).normalize(), hit.t - 0.05);
    a.stuck = true;
    return true;
  }
  a.pos.add(a.vel);
  a.vel.multiplyScalar(ARROW_DRAG);
  a.vel.y -= ARROW_GRAVITY;
  return a.pos.y > -5;
}

// ---------------------------------------------------------------- fishing rod
export function castHook(owner, origin, direction, { visual = false } = {}) {
  const mesh = new THREE.Mesh(hookGeo, hookMats);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin, origin]), lineMat);
  line.frustumCulled = false;
  scene.add(mesh, line);
  const hook = { owner, mesh, line, visual, pos: origin.clone(), prev: origin.clone(), vel: direction.clone().normalize().multiplyScalar(HOOK_SPEED), age: 0, stuck: false, attached: null };
  hooks.add(hook);
  if (!visual) announce(owner, 'hook', origin, direction);
  sfx('bow');
  return hook;
}

/** Pull the line in. A hooked fighter gets yanked toward the angler. */
export function reelHook(hook) {
  if (!hook || !hooks.has(hook)) return;
  if (hook.attached?.alive && !hook.visual) {
    const t = hook.attached, o = hook.owner;
    const dx = o.pos.x - t.pos.x, dy = o.pos.y - t.pos.y, dz = o.pos.z - t.pos.z;
    const pull = { x: dx * 0.1, y: dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08, z: dz * 0.1 };
    if (t.remote) net.send({ t: 'pull', id: t.netId, v: [pull.x, pull.y, pull.z] }); // the server moves them
    else { t.vel.x += pull.x; t.vel.y += pull.y; t.vel.z += pull.z; }
  }
  if (hook.owner === player && net.online) net.send({ t: 'reel' });
  removeHook(hook);
}

function removeHook(hook) {
  scene.remove(hook.mesh, hook.line);
  hook.line.geometry.dispose();
  hooks.delete(hook);
  if (hook.owner.hook === hook) hook.owner.hook = null;
}

function tickHook(h) {
  h.prev.copy(h.pos);
  h.age++;
  if (!h.owner.alive || h.pos.distanceTo(h.owner.pos) > HOOK_MAX_RANGE) return false;
  if (h.attached) {
    if (!h.attached.alive) return false;
    h.pos.set(h.attached.pos.x, h.attached.pos.y + h.attached.h * 0.8, h.attached.pos.z);
    return true;
  }
  if (h.stuck) return true;
  const hit = sweep(h);
  if (hit?.fighter) {
    if (!h.visual) damage(hit.fighter, 0, h.owner, 'rod');
    sfx('hit');
    h.attached = hit.fighter;
    return true;
  }
  if (hit?.block) {
    h.pos.addScaledVector(_dir.copy(h.vel).normalize(), hit.t - 0.08);
    h.stuck = true;
    return true;
  }
  h.pos.add(h.vel);
  h.vel.multiplyScalar(HOOK_DRAG);
  h.vel.y -= HOOK_GRAVITY;
  return h.pos.y > -5;
}

// ---------------------------------------------------------------- thrown potions and pearls
/** Throw a splash potion or pearl. `velocity` in blocks per tick. */
export function throwItem(owner, kind, origin, velocity, { visual = false } = {}) {
  const def = THROWN[kind], mesh = new THREE.Mesh(def.geo, itemMat);
  mesh.scale.setScalar(def.scale);
  mesh.position.copy(origin);
  scene.add(mesh);
  thrown.push({ kind, def, owner, visual, mesh, pos: origin.clone(), prev: origin.clone(), vel: velocity.clone(), age: 0 });
  if (!visual) announce(owner, kind, origin, velocity);
}

/** Splash particles and sound (also used for other players' potions). */
export function splashEffect(point) {
  burst(point, [0xff7aa8, 0xe8336e, 0xffd2e1], 22, 3.2, 1, { lift: 0.6 });
  sfx('splash');
}

/** Remove a fighter's fishing line (another player reeled in). */
export function dropHook(owner) {
  for (const h of [...hooks]) if (h.owner === owner) removeHook(h);
}

function splash(point, direct) {
  if (net.online) { // the server heals everyone near the splash
    net.send({ t: 'splash', p: [point.x, point.y, point.z], d: direct?.remote ? direct.netId : direct === player ? -1 : null });
    splashEffect(point);
    return;
  }
  for (const f of fighters) {
    if (!f.alive) continue;
    const dx = f.pos.x - point.x, dy = f.pos.y - point.y, dz = f.pos.z - point.z;
    if (Math.abs(dy) > 2 + f.h) continue;
    const d = Math.hypot(dx, dy, dz);
    if (d >= SPLASH_RADIUS && f !== direct) continue;
    const amount = Math.floor((f === direct ? 1 : 1 - d / SPLASH_RADIUS) * SPLASH_HEAL + 0.5);
    if (amount > 0) heal(f, amount);
  }
  splashEffect(point);
}

const fits = (f, x, y, z) => {
  const hw = f.w / 2;
  for (let yy = Math.floor(y); yy <= Math.floor(y + f.h - 1e-6); yy++) {
    for (let xx = Math.floor(x - hw); xx <= Math.floor(x + hw - 1e-6); xx++) {
      for (let zz = Math.floor(z - hw); zz <= Math.floor(z + hw - 1e-6); zz++) if (solid(xx, yy, zz)) return false;
    }
  }
  return true;
};

function pearlLand(t, point, hit) {
  const o = t.owner;
  if (!o.alive) return;
  let { x, y, z } = point;
  if (hit.block) {
    x += (hit.nx || 0) * 0.32; z += (hit.nz || 0) * 0.32;
    if (hit.ny === 1) y = Math.round(y); else if (hit.ny === -1) y -= o.h;
  }
  for (let up = 0; up <= 2; up++) {
    if (!fits(o, x, y + up, z)) continue;
    burst(o.pos.clone().setY(o.pos.y + 1), [0x2fa58c, 0x9ff5df], 12, 2.5);
    o.pos.set(x, y + up, z);
    o.prevPos.copy(o.pos);
    o.vel.set(0, 0, 0);
    o.fallDistance = 0;
    burst(o.pos.clone().setY(o.pos.y + 1), [0x2fa58c, 0x9ff5df], 12, 2.5);
    sfx('pearl');
    damage(o, PEARL_DAMAGE, null, 'pearl');
    return;
  }
}

function tickThrown(t) {
  t.prev.copy(t.pos);
  t.age++;
  const hit = sweep(t);
  if (hit) {
    const point = t.pos.clone().addScaledVector(_dir.copy(t.vel).normalize(), Math.max(0, hit.t - 0.05));
    if (t.visual) { if (t.kind === 'splash') splashEffect(point); return false; }
    if (t.kind === 'splash') splash(point, hit.fighter || null);
    else pearlLand(t, point, hit);
    return false;
  }
  t.pos.add(t.vel);
  t.vel.multiplyScalar(t.def.drag);
  t.vel.y -= t.def.gravity;
  return t.pos.y > map.killY - 10 && t.age < 400;
}

/** Remove every projectile (used when a different map loads). */
export function clearProjectiles() {
  for (const a of arrows) scene.remove(a.g);
  arrows.length = 0;
  for (const h of [...hooks]) removeHook(h);
  for (const t of thrown) scene.remove(t.mesh);
  thrown.length = 0;
}

// ---------------------------------------------------------------- update + render
export function tickProjectiles(dt) {
  for (let i = thrown.length - 1; i >= 0; i--) {
    if (!tickThrown(thrown[i])) { scene.remove(thrown[i].mesh); thrown.splice(i, 1); }
  }
  for (let i = arrows.length - 1; i >= 0; i--) {
    if (!tickArrow(arrows[i], dt)) { scene.remove(arrows[i].g); arrows.splice(i, 1); }
  }
  for (const h of [...hooks]) if (!tickHook(h)) removeHook(h);
}

/**
 * Interpolate meshes between ticks. `rodTip(owner, out)` returns the world-space rod tip for a
 * fishing line (supplied by the renderer, which knows where hands and cameras are).
 */
export function renderProjectiles(alpha, rodTip) {
  for (const t of thrown) {
    t.mesh.position.lerpVectors(t.prev, t.pos, alpha);
    t.mesh.rotation.set(0, (t.age + alpha) * 0.5, (t.age + alpha) * 0.3);
  }
  for (const a of arrows) {
    a.g.position.lerpVectors(a.prev, a.pos, alpha);
    if (!a.stuck) a.g.lookAt(_look.copy(a.g.position).add(a.vel));
  }
  for (const h of hooks) {
    h.mesh.position.lerpVectors(h.prev, h.pos, alpha);
    rodTip(h.owner, _tip);
    const attr = h.line.geometry.attributes.position;
    attr.setXYZ(0, _tip.x, _tip.y, _tip.z);
    attr.setXYZ(1, h.mesh.position.x, h.mesh.position.y, h.mesh.position.z);
    attr.needsUpdate = true;
  }
}
