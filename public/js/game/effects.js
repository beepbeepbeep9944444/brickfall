// Lightweight cube particles (hits, crits, block breaks, deaths).
import * as THREE from '../vendor/three.js';
import { pick, rand } from '../core/util.js';
import { settings } from '../core/settings.js';
import { scene } from '../render/scene.js';
import { solid } from '../world/world.js';

const PARTICLE_SCALE = [0.15, 0.5, 1]; // indexed by settings.particles
const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const mats = new Map();
const parts = [];

const matFor = (color) => {
  if (!mats.has(color)) mats.set(color, new THREE.MeshBasicMaterial({ color }));
  return mats.get(color);
};

/** Spawn `count` particles. `lift` biases them upward (hearts float, fire rises). */
export function burst(pos, color, count = 8, speed = 3, size = 1, { lift = 0, gravity = 16, life = 1 } = {}) {
  const n = Math.round(count * PARTICLE_SCALE[settings.particles]);
  for (let i = 0; i < n; i++) {
    const c = Array.isArray(color) ? pick(color) : color;
    const m = new THREE.Mesh(geo, matFor(c));
    const s = size * rand(0.6, 1.4);
    m.position.copy(pos);
    m.scale.setScalar(s);
    scene.add(m);
    parts.push({
      m, s, gravity, life: rand(0.4, 0.9) * life,
      v: new THREE.Vector3(rand(-1, 1), rand(0.3, 1.4) + lift, rand(-1, 1)).multiplyScalar(speed),
    });
  }
}

export function updateEffects(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); continue; }
    p.v.y -= p.gravity * dt;
    p.m.position.addScaledVector(p.v, dt);
    const q = p.m.position;
    if (solid(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))) {
      q.addScaledVector(p.v, -dt);
      p.v.multiplyScalar(0.3);
      p.v.y = Math.abs(p.v.y);
    }
    p.m.scale.setScalar(p.s * Math.min(1, p.life * 2.5));
  }
}
