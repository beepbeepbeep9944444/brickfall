// Chunked terrain meshing with hidden-face culling and per-vertex ambient occlusion.
import * as THREE from '../vendor/three.js';
import { scene } from '../render/scene.js';
import { worldMat } from '../render/materials.js';
import { FACES } from '../render/geometry.js';
import { AN, BLOCK_TILES } from '../render/textures.js';
import { W, H, D, world, wi, getB } from './world.js';

const CS = 16; // chunk size (x/z)
const AO = [0.45, 0.64, 0.82, 1];
const UV_INSET = 0.002;

const chunks = [];
for (let i = 0; i < W / CS; i++) for (let j = 0; j < D / CS; j++) chunks.push({ i, j, mesh: null });
const chunkAt = (x, z) => chunks[Math.floor(x / CS) * (D / CS) + Math.floor(z / CS)];
const dirty = new Set();

function vertexAO(x, y, z, d, c) {
  const bx = x + d[0], by = y + d[1], bz = z + d[2];
  let a1 = -1, a2 = -1;
  for (let a = 0; a < 3; a++) if (d[a] === 0) { if (a1 < 0) a1 = a; else a2 = a; }
  const o1 = [0, 0, 0], o2 = [0, 0, 0];
  o1[a1] = c[a1] ? 1 : -1;
  o2[a2] = c[a2] ? 1 : -1;
  const s1 = getB(bx + o1[0], by + o1[1], bz + o1[2]) ? 1 : 0;
  const s2 = getB(bx + o2[0], by + o2[1], bz + o2[2]) ? 1 : 0;
  const cc = getB(bx + o1[0] + o2[0], by + o1[1] + o2[1], bz + o1[2] + o2[2]) ? 1 : 0;
  return s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
}

function buildChunk(ch) {
  const pos = [], uv = [], col = [], ind = [], x0 = ch.i * CS, z0 = ch.j * CS;
  for (let y = 0; y < H; y++) {
    for (let z = z0; z < z0 + CS; z++) {
      for (let x = x0; x < x0 + CS; x++) {
        const b = world[wi(x, y, z)];
        if (!b) continue;
        const tiles = BLOCK_TILES[b];
        for (const F of FACES) {
          if (getB(x + F.dir[0], y + F.dir[1], z + F.dir[2])) continue;
          const tile = F.dir[1] === 1 ? tiles[0] : F.dir[1] === -1 ? tiles[1] : tiles[2];
          const tx = tile % AN, ty = Math.floor(tile / AN), n = pos.length / 3;
          for (const c of F.corners) {
            pos.push(x + c[0], y + c[1], z + c[2]);
            uv.push((tx + (c[3] ? 1 - UV_INSET : UV_INSET)) / AN, 1 - (ty + (c[4] ? UV_INSET : 1 - UV_INSET)) / AN);
            const s = F.shade * AO[vertexAO(x, y, z, F.dir, c)];
            col.push(s, s, s);
          }
          ind.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(ind);
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
  ch.mesh = new THREE.Mesh(g, worldMat);
  scene.add(ch.mesh);
}

export function buildAllChunks() {
  chunks.forEach(buildChunk);
}

/** Queue the chunk containing (x, z), plus neighbours (AO and faces cross chunk borders). */
export function markDirty(x, z) {
  for (const dx of [-1, 0, 1]) {
    for (const dz of [-1, 0, 1]) {
      const xx = x + dx, zz = z + dz;
      if (xx >= 0 && zz >= 0 && xx < W && zz < D) dirty.add(chunkAt(xx, zz));
    }
  }
}

/** Rebuild any chunks changed this frame. */
export function flushDirty() {
  if (!dirty.size) return;
  for (const c of dirty) buildChunk(c);
  dirty.clear();
}
