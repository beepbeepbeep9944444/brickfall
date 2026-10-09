// Player-placed blocks. Only these can be broken, and they crumble after BLOCK_LIFE seconds
// so the arena resets itself.
import * as THREE from '../vendor/three.js';
import { game } from '../core/state.js';
import { BLOCK_COLOR } from '../render/textures.js';
import { burst } from '../game/effects.js';
import { W, D, world, wi, setB } from './world.js';
import { markDirty } from './mesher.js';

export const BLOCK_LIFE = 45;

const placed = new Map(); // world index -> expiry time
const _p = new THREE.Vector3();

export const isPlaced = (x, y, z) => placed.has(wi(x, y, z));

export function placeBlock(x, y, z, type) {
  setB(x, y, z, type);
  placed.set(wi(x, y, z), game.time + BLOCK_LIFE);
  markDirty(x, z);
}

/** Remove a placed block; returns its type. */
export function removeBlock(x, y, z) {
  const k = wi(x, y, z), type = world[k];
  setB(x, y, z, 0);
  placed.delete(k);
  markDirty(x, z);
  return type;
}

/** Forget every placed block (the world itself is regenerated separately). */
export function clearPlaced() {
  placed.clear();
}

/** Take every placed block out of the world (leaving or joining an online room). */
export function removeAllPlaced() {
  for (const k of [...placed.keys()]) {
    const x = k % W, z = Math.floor(k / W) % D, y = Math.floor(k / (W * D));
    removeBlock(x, y, z);
  }
}

let checkTimer = 0;
export function updatePlacedBlocks(dt) {
  checkTimer -= dt;
  if (checkTimer > 0) return;
  checkTimer = 0.5;
  for (const [k, expires] of placed) {
    if (game.time < expires) continue;
    const x = k % W, z = Math.floor(k / W) % D, y = Math.floor(k / (W * D));
    if (world[k]) {
      burst(_p.set(x + 0.5, y + 0.5, z + 0.5), BLOCK_COLOR[world[k]], 6, 2);
      world[k] = 0;
      markDirty(x, z);
    }
    placed.delete(k);
  }
}
